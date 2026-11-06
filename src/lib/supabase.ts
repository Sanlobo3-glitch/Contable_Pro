import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import demoImgCafe from '../assets/images/demo_cafe_gourmet_1793679709320.jpg'
import demoImgAceite from '../assets/images/demo_aceite_vegetal_1793679709880.jpg'
import demoImgHarina from '../assets/images/demo_harina_maiz_1793679711220.jpg'
import demoImgAzucar from '../assets/images/demo_azucar_refinada_1793679711892.jpg'
import demoImgQueso from '../assets/images/demo_queso_blanco_1793679713675.jpg'
import demoImgLeche from '../assets/images/demo_leche_entera_1793679714392.jpg'
import demoImgArroz from '../assets/images/demo_arroz_extra_1793679714609.jpg'
import demoImgDetergente from '../assets/images/demo_detergente_multiuso_1793679715798.jpg'

function normalizeSupabaseUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return ''
  try {
    const u = new URL(trimmed)
    const cleanPath = u.pathname
      .replace(/\/+(rest|auth|storage|functions|realtime)\/v1\/?$/i, '')
      .replace(/\/+$/, '')
    return `${u.origin}${cleanPath}`
  } catch {
    return trimmed
      .replace(/\/+(rest|auth|storage|functions|realtime)\/v1\/?$/i, '')
      .replace(/\/+$/, '')
  }
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function createMockSupabase(silent = false): SupabaseClient {
  if (!silent) {
    console.warn('[AI Studio] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — using in-memory Supabase mock')
  }

  const DEMO_COMPANY_ID = '00000000-0000-4000-8000-000000000001'
  const nowIso = () => new Date().toISOString()
  const daysAgoIso = (days: number, hoursOffset = 0) =>
    new Date(Date.now() - days * 86400000 - hoursOffset * 3600000).toISOString()
  const daysFromNowYmd = (days: number) =>
    new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE')
  const trialEndIso = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  const makeDemoReceiptSvg = (p: {
    platform: string
    reference: string
    amountText: string
    sender: string
    receiver: string
    dateText: string
    accentHex: string
  }) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="720" viewBox="0 0 540 720">
      <rect width="540" height="720" rx="24" fill="#f8fafc"/>
      <rect x="24" y="24" width="492" height="672" rx="18" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
      <rect x="24" y="24" width="492" height="118" rx="18" fill="${p.accentHex}"/>
      <text x="52" y="72" fill="#ffffff" font-family="system-ui, sans-serif" font-size="14" font-weight="600" opacity="0.9">${p.platform.toUpperCase()}</text>
      <text x="52" y="106" fill="#ffffff" font-family="system-ui, sans-serif" font-size="24" font-weight="700">Transacción Exitosa</text>
      <text x="52" y="192" fill="#64748b" font-family="system-ui, sans-serif" font-size="13" font-weight="600">MONTO TRANSFERIDO</text>
      <text x="52" y="238" fill="#0f172a" font-family="system-ui, sans-serif" font-size="36" font-weight="800">${p.amountText}</text>
      <line x1="52" y1="268" x2="488" y2="268" stroke="#e2e8f0" stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="52" y="314" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Referencia bancaria</text>
      <text x="488" y="314" text-anchor="end" fill="#0f172a" font-family="monospace" font-size="16" font-weight="700">#${p.reference}</text>
      <text x="52" y="366" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Fecha y hora</text>
      <text x="488" y="366" text-anchor="end" fill="#0f172a" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${p.dateText}</text>
      <text x="52" y="418" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Origen / Ordenante</text>
      <text x="488" y="418" text-anchor="end" fill="#0f172a" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${p.sender}</text>
      <text x="52" y="470" fill="#64748b" font-family="system-ui, sans-serif" font-size="13">Beneficiario</text>
      <text x="488" y="470" text-anchor="end" fill="#0f172a" font-family="system-ui, sans-serif" font-size="14" font-weight="600">${p.receiver}</text>
      <rect x="52" y="536" width="436" height="92" rx="12" fill="#f1f5f9"/>
      <text x="270" y="574" text-anchor="middle" fill="#334155" font-family="system-ui, sans-serif" font-size="13" font-weight="600">Comprobante digital adjunto por el cliente</text>
      <text x="270" y="600" text-anchor="middle" fill="#64748b" font-family="system-ui, sans-serif" font-size="12">Verificación administrativa InventarioPro</text>
    </svg>`
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  }

  const tables: Record<string, Row[]> = {
    profiles: [
      {
        id: 'demo-dueno-1',
        email: 'gerencia@losandesdemo.com',
        full_name: 'Valentina Morales',
        role: 'dueno',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: daysAgoIso(90),
        trial_start: daysAgoIso(90),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-owner-1',
        email: 'admin@empresa.com',
        full_name: 'Administrador Demo',
        role: 'admin',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: nowIso(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'profesional',
      },
      {
        id: 'demo-seller-1',
        email: 'carlos.ruta@losandesdemo.com',
        full_name: 'Carlos Méndez',
        role: 'vendedor',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-seller-2',
        email: 'lucia.ventas@losandesdemo.com',
        full_name: 'Lucía Rojas',
        role: 'vendedor',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-admin-emp-1',
        email: 'operaciones@losandesdemo.com',
        full_name: 'Andrés Castellanos',
        role: 'admin_empresa',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 40 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-contador-1',
        email: 'contabilidad@losandesdemo.com',
        full_name: 'Elena Rivas',
        role: 'contador',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 38 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-almacen-1',
        email: 'almacen@losandesdemo.com',
        full_name: 'Marco Paredes',
        role: 'almacen',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-transporte-1',
        email: 'logistica@losandesdemo.com',
        full_name: 'Rafael Bermúdez',
        role: 'transportador',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 28 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'empresarial',
      },
      {
        id: 'demo-tecnico-1',
        email: 'soporte@inventariopro.demo',
        full_name: 'Ing. Gabriel Soto',
        role: 'tecnico',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'active',
        subscription_end: trialEndIso,
        paypal_order_id: null,
        plan_type: 'corporativo',
      },
    ],
    member_profiles: [
      {
        user_id: 'demo-dueno-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-16420890',
        phone: '+58 412-5550140',
        job_title: 'Directora Comercial',
        zone: 'Sede Principal',
        address: 'Av. Las Américas, Torre Empresarial, Piso 3',
        emergency_contact: 'Ricardo Morales · 0414-5550199',
        hire_date: '2025-01-10',
        base_salary: 0,
        commission_pct: 0,
        notes: 'Cuenta principal de demostración',
        archived: false,
      },
      {
        user_id: 'demo-owner-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-14500111',
        phone: '+58 412-5550100',
        job_title: 'Gerente General',
        zone: 'Sede Principal',
        address: 'Av. Principal, Edif. Centro',
        emergency_contact: 'Ana Méndez · 0414-5550199',
        hire_date: '2025-01-15',
        base_salary: 0,
        commission_pct: 0,
        notes: 'Administrador principal',
        archived: false,
      },
      {
        user_id: 'demo-seller-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-20884312',
        phone: '+58 414-3219876',
        job_title: 'Vendedor Senior de Ruta',
        zone: 'Ruta Norte y Centro',
        address: 'Urb. Las Acacias, Calle 4',
        emergency_contact: 'Pedro Méndez · 0414-1112233',
        hire_date: '2026-02-01',
        base_salary: 280,
        commission_pct: 5,
        notes: 'Moto asignada placa AB123CD',
        archived: false,
      },
      {
        user_id: 'demo-seller-2',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-23910445',
        phone: '+58 424-9981122',
        job_title: 'Ejecutiva Comercial',
        zone: 'Ruta Este y Mayoristas',
        address: 'Res. Parque Sol, Torre B',
        emergency_contact: 'Elena Rojas · 0424-7778899',
        hire_date: '2026-03-10',
        base_salary: 250,
        commission_pct: 4.5,
        notes: 'Especialista en panaderías y abastos',
        archived: false,
      },
      {
        user_id: 'demo-admin-emp-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-18340921',
        phone: '+58 412-6104432',
        job_title: 'Administrador de Operaciones',
        zone: 'Multisede',
        address: 'Av. Las Américas, Torre Empresarial',
        emergency_contact: 'Sofía Castellanos · 0412-9001122',
        hire_date: '2025-06-01',
        base_salary: 450,
        commission_pct: 1.5,
        notes: 'Supervisión de sucursales, precios y vendedores',
        archived: false,
      },
      {
        user_id: 'demo-contador-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-17299018',
        phone: '+58 414-7023310',
        job_title: 'Contadora General',
        zone: 'Finanzas y Libros',
        address: 'Urb. El Rosal, Calle 2',
        emergency_contact: 'Luis Rivas · 0414-7029988',
        hire_date: '2025-08-15',
        base_salary: 420,
        commission_pct: 0,
        notes: 'Responsable de libros diarios, conciliación e impuestos',
        archived: false,
      },
      {
        user_id: 'demo-almacen-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-19554302',
        phone: '+58 424-5182290',
        job_title: 'Jefe de Centro de Distribución',
        zone: 'Bodega Principal y Traslados',
        address: 'Zona Industrial Norte',
        emergency_contact: 'Carmen Paredes · 0424-5180001',
        hire_date: '2025-09-01',
        base_salary: 340,
        commission_pct: 0,
        notes: 'Control de recepciones, lotes FEFO y despachos entre sedes',
        archived: false,
      },
      {
        user_id: 'demo-transporte-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-21440812',
        phone: '+58 412-8841209',
        job_title: 'Coordinador de Transporte y Despacho',
        zone: 'Rutas Urbanas y Foráneas',
        address: 'Zona Industrial Norte, Galpón 4',
        emergency_contact: 'Luisa Bermúdez · 0412-8840099',
        hire_date: '2025-10-12',
        base_salary: 310,
        commission_pct: 1,
        notes: 'Responsable de hojas de despacho y retorno de unidades',
        archived: false,
      },
      {
        user_id: 'demo-tecnico-1',
        company_id: DEMO_COMPANY_ID,
        avatar_url: null,
        national_id: 'V-19002451',
        phone: '+58 414-9004512',
        job_title: 'Especialista de Soporte Técnico e Integraciones',
        zone: 'Mesa de Ayuda Central',
        address: 'Centro Tecnológico Empresarial',
        emergency_contact: 'Mesa Central · 0414-9000000',
        hire_date: '2025-04-01',
        base_salary: 0,
        commission_pct: 0,
        notes: 'Atención de solicitudes autorizadas de usuarios',
        archived: false,
      },
    ],
    company_invites: [
      {
        id: 'inv-demo-1',
        company_id: DEMO_COMPANY_ID,
        code: 'EQP7842',
        active: true,
        max_uses: 5,
        used_count: 2,
        expires_at: new Date(Date.now() + 6 * 86400000).toISOString(),
        created_at: nowIso(),
      },
    ],
    devices: [
      {
        id: 'dev-demo-1',
        company_id: DEMO_COMPANY_ID,
        user_id: 'demo-owner-1',
        device_key: 'demo-pc',
        name: 'PC Administración',
        kind: 'pc',
        os: 'Windows 11',
        browser: 'Chrome',
        status: 'autorizado',
        last_seen: nowIso(),
      },
      {
        id: 'dev-demo-2',
        company_id: DEMO_COMPANY_ID,
        user_id: 'demo-seller-1',
        device_key: 'demo-movil-1',
        name: 'Teléfono Ruta Norte (Carlos)',
        kind: 'movil',
        os: 'Android 14',
        browser: 'Chrome Mobile',
        status: 'autorizado',
        last_seen: new Date(Date.now() - 18 * 60000).toISOString(),
      },
    ],
    company_config: [
      {
        id: 'cfg-demo-1',
        company_id: DEMO_COMPANY_ID,
        name: 'Distribuidora Los Andes C.A.',
        rif: 'J-41289034-7',
        address: 'Av. Las Américas, Galpón 12, Zona Comercial',
        phone: '+58 412-5550140',
        email: 'ventas@losandesdemo.com',
        currency: 'USD',
        tax_rate: 16,
        tax_mode: 'none',
        invoice_prefix: 'FAC',
        geo_mode: 'optional',
        currency_confirmed: true,
        fx_rates: { VES: 42.5, COP: 4180 },
        logo_url: null,
        brand_theme: 'emerald',
        catalog_slug: 'distribuidora-los-andes',
        catalog_enabled: true,
        catalog_show_wholesale: true,
        catalog_show_stock: true,
        catalog_welcome: 'Tienda oficial mayorista y detal · Elige tus presentaciones y adjunta tu comprobante de pago.',
        catalog_delivery_modes: ['pickup', 'delivery', 'shipping'],
        whatsapp_settings: {
          business_whatsapp: '+58 412-5550140',
          brand_tagline: 'Tienda oficial mayorista y detal · Despacho rápido garantizado',
          og_card_subtitle: 'Selecciona presentaciones, verifica existencias en vivo y adjunta tu capture de pago.',
          business_hours: 'Lunes a Sábado · 8:00 a.m. a 5:30 p.m.',
          advisor_title: 'Asesor Comercial',
          include_rif_in_messages: true,
          include_hours_in_messages: true,
          include_payment_summary_in_messages: false,
        },
        catalog_payment_methods: [
          {
            id: 'pago_movil',
            enabled: true,
            label: 'Pago Móvil Interbancario',
            requires_proof: true,
            bank_or_platform: 'Banesco (0134)',
            account_or_phone: '0412-5550140',
            holder_name: 'Distribuidora Los Andes C.A.',
            holder_document: 'J-41289034-7',
            instructions: 'Realiza el Pago Móvil a la tasa oficial mostrada y adjunta el capture con referencia visible.',
          },
          {
            id: 'nequi',
            enabled: true,
            label: 'Nequi / Billetera Móvil',
            requires_proof: true,
            bank_or_platform: 'Nequi Corporativo',
            account_or_phone: '300 412 8900',
            holder_name: 'Distribuidora Los Andes',
            holder_document: 'NIT 901.412.890-3',
            instructions: 'Envía pantallazo del comprobante exitoso con código M.',
          },
          {
            id: 'zelle',
            enabled: true,
            label: 'Zelle / Divisas Digitales',
            requires_proof: true,
            bank_or_platform: 'Zelle',
            account_or_phone: 'pagos@losandesdemo.com',
            holder_name: 'Los Andes Trading LLC',
            holder_document: '',
            instructions: 'Coloca el nombre de tu comercio o cédula en la nota del envío.',
          },
          {
            id: 'transferencia',
            enabled: true,
            label: 'Transferencia Bancaria',
            requires_proof: true,
            bank_or_platform: 'Banesco Cuenta Corriente',
            account_or_phone: '0134-0342-18-3421089012',
            holder_name: 'Distribuidora Los Andes C.A.',
            holder_document: 'J-41289034-7',
            instructions: 'Adjunta el comprobante PDF/imagen de la transferencia.',
          },
          {
            id: 'efectivo_entrega',
            enabled: true,
            label: 'Pago al recibir / Punto en sede',
            requires_proof: false,
            bank_or_platform: 'Efectivo o Punto de Venta',
            account_or_phone: '',
            holder_name: 'Distribuidora Los Andes C.A.',
            holder_document: 'J-41289034-7',
            instructions: 'Cancela directamente al retirar en galpón o al recibir la unidad de despacho.',
          },
        ],
      },
    ],
    categories: [
      { id: 'cat-1', name: 'Víveres y Granos', description: 'Harinas, arroz, pastas y granos básicos', created_at: daysAgoIso(60) },
      { id: 'cat-2', name: 'Bebidas y Café', description: 'Café tostado, infusiones y bebidas', created_at: daysAgoIso(60) },
      { id: 'cat-3', name: 'Lácteos y Refrigerados', description: 'Leches, quesos y derivados con control de lote', created_at: daysAgoIso(60) },
      { id: 'cat-4', name: 'Hogar y Limpieza', description: 'Detergentes, desinfectantes e insumos', created_at: daysAgoIso(60) },
    ],
    products: [
      {
        id: 'prod-1',
        name: 'Café Molido Gourmet 500g',
        sku: '75910001',
        category_id: 'cat-2',
        price: 6.5,
        price_wholesale: 5.8,
        wholesale_min_qty: 6,
        cost: 4.2,
        stock: 34,
        min_stock: 10,
        unit: 'unidad',
        tracks_expiry: false,
        image_url: demoImgCafe,
        description: 'Grano arábica de altura tostado medio, molienda fina ideal para greca y expreso.',
        featured: true,
        catalog_visible: true,
        variant_group_label: 'Peso / Empaque',
        variants: [
          { id: 'v-cafe-250g', label: '250 g', price: 3.45, price_wholesale: 3.1, stock_multiplier: 0.5, available: true },
          { id: 'v-cafe-500g', label: '500 g', price: 6.5, price_wholesale: 5.8, stock_multiplier: 1, available: true },
          { id: 'v-cafe-1kg', label: '1 kg', price: 12.4, price_wholesale: 11.1, stock_multiplier: 2, available: true },
          { id: 'v-cafe-bulto12', label: 'Bulto × 12 (500 g)', price: 67.2, price_wholesale: 65.4, stock_multiplier: 12, available: true },
        ],
        created_at: daysAgoIso(45),
      },
      {
        id: 'prod-2',
        name: 'Aceite Vegetal Puro 1L',
        sku: '75910002',
        category_id: 'cat-1',
        price: 3.25,
        price_wholesale: 2.95,
        wholesale_min_qty: 12,
        cost: 2.1,
        stock: 18,
        min_stock: 12,
        unit: 'litro',
        tracks_expiry: false,
        image_url: demoImgAceite,
        description: 'Aceite comestible 100% vegetal libre de colesterol, disponible por mililitros, litro y bidón.',
        featured: false,
        catalog_visible: true,
        variant_group_label: 'Volumen',
        variants: [
          { id: 'v-aceite-500ml', label: '500 ml', price: 1.75, price_wholesale: 1.58, stock_multiplier: 0.5, available: true },
          { id: 'v-aceite-1l', label: '1 Litro', price: 3.25, price_wholesale: 2.95, stock_multiplier: 1, available: true },
          { id: 'v-aceite-5l', label: 'Bidón 5 Litros', price: 15.4, price_wholesale: 14.2, stock_multiplier: 5, available: true },
        ],
        created_at: daysAgoIso(45),
      },
      {
        id: 'prod-3',
        name: 'Harina de Maíz Precocida 1kg',
        sku: '75910003',
        category_id: 'cat-1',
        price: 1.4,
        price_wholesale: 1.25,
        wholesale_min_qty: 20,
        cost: 0.95,
        stock: 68,
        min_stock: 20,
        unit: 'unidad',
        tracks_expiry: false,
        image_url: demoImgHarina,
        description: 'Harina blanca de maíz blanco seleccionado enriquecida con vitaminas y hierro.',
        featured: true,
        catalog_visible: true,
        variant_group_label: 'Empaque',
        variants: [
          { id: 'v-har-1kg', label: 'Unidad 1 kg', price: 1.4, price_wholesale: 1.25, stock_multiplier: 1, available: true },
          { id: 'v-har-10kg', label: 'Medio Bulto × 10 kg', price: 12.8, price_wholesale: 12.2, stock_multiplier: 10, available: true },
          { id: 'v-har-20kg', label: 'Bulto × 20 kg', price: 24.4, price_wholesale: 23.6, stock_multiplier: 20, available: true },
        ],
        created_at: daysAgoIso(45),
      },
      {
        id: 'prod-4',
        name: 'Azúcar Refinada 1kg',
        sku: '75910004',
        category_id: 'cat-1',
        price: 1.65,
        price_wholesale: 1.5,
        wholesale_min_qty: 12,
        cost: 1.15,
        stock: 0,
        min_stock: 15,
        unit: 'unidad',
        tracks_expiry: false,
        image_url: demoImgAzucar,
        description: 'Azúcar blanca cristalina de alta pureza para consumo familiar y repostería.',
        featured: false,
        catalog_visible: true,
        variant_group_label: null,
        variants: [],
        created_at: daysAgoIso(45),
      },
      {
        id: 'prod-5',
        name: 'Queso Blanco Pasteurizado 1kg',
        sku: '75910005',
        category_id: 'cat-3',
        price: 7.8,
        price_wholesale: 7.1,
        wholesale_min_qty: 5,
        cost: 5.4,
        stock: 14,
        min_stock: 8,
        unit: 'kg',
        tracks_expiry: true,
        image_url: demoImgQueso,
        description: 'Queso fresco pasteurizado empacado al vacío con control estricto de cadena de frío.',
        featured: true,
        catalog_visible: true,
        variant_group_label: 'Peso',
        variants: [
          { id: 'v-queso-500g', label: '500 g', price: 4.1, price_wholesale: 3.75, stock_multiplier: 0.5, available: true },
          { id: 'v-queso-1kg', label: '1 kg', price: 7.8, price_wholesale: 7.1, stock_multiplier: 1, available: true },
          { id: 'v-queso-35kg', label: 'Horma 3.5 kg', price: 25.2, price_wholesale: 24.15, stock_multiplier: 3.5, available: true },
        ],
        created_at: daysAgoIso(40),
      },
      {
        id: 'prod-6',
        name: 'Leche Entera UHT 1L',
        sku: '75910006',
        category_id: 'cat-3',
        price: 2.1,
        price_wholesale: 1.85,
        wholesale_min_qty: 12,
        cost: 1.35,
        stock: 6,
        min_stock: 12,
        unit: 'litro',
        tracks_expiry: true,
        image_url: demoImgLeche,
        description: 'Leche entera larga duración en envase Tetra Brik con tapa rosca.',
        featured: false,
        catalog_visible: true,
        variant_group_label: 'Volumen',
        variants: [
          { id: 'v-leche-250ml', label: '250 ml', price: 0.65, price_wholesale: 0.58, stock_multiplier: 0.25, available: true },
          { id: 'v-leche-1l', label: '1 Litro', price: 2.1, price_wholesale: 1.85, stock_multiplier: 1, available: true },
        ],
        created_at: daysAgoIso(40),
      },
      {
        id: 'prod-7',
        name: 'Arroz Blanco Extra 1kg',
        sku: '75910007',
        category_id: 'cat-1',
        price: 1.55,
        price_wholesale: 1.38,
        wholesale_min_qty: 24,
        cost: 1.02,
        stock: 52,
        min_stock: 18,
        unit: 'unidad',
        tracks_expiry: false,
        image_url: demoImgArroz,
        description: 'Arroz grano entero 99% selección extra, suelto y de alto rendimiento.',
        featured: true,
        catalog_visible: true,
        variant_group_label: 'Empaque',
        variants: [
          { id: 'v-arroz-1kg', label: 'Unidad 1 kg', price: 1.55, price_wholesale: 1.38, stock_multiplier: 1, available: true },
          { id: 'v-arroz-fardo24', label: 'Fardo × 24 kg', price: 33.12, price_wholesale: 32.4, stock_multiplier: 24, available: true },
        ],
        created_at: daysAgoIso(35),
      },
      {
        id: 'prod-8',
        name: 'Detergente Multiuso 2kg',
        sku: '75910008',
        category_id: 'cat-4',
        price: 4.9,
        price_wholesale: 4.4,
        wholesale_min_qty: 6,
        cost: 3.15,
        stock: 22,
        min_stock: 8,
        unit: 'unidad',
        tracks_expiry: false,
        image_url: demoImgDetergente,
        description: 'Detergente biodegradable en polvo de alto poder desengrasante y aroma fresco.',
        featured: false,
        catalog_visible: true,
        variant_group_label: 'Presentación',
        variants: [
          { id: 'v-det-500g', label: '500 g', price: 1.45, price_wholesale: 1.3, stock_multiplier: 0.25, available: true },
          { id: 'v-det-2kg', label: 'Bolsa 2 kg', price: 4.9, price_wholesale: 4.4, stock_multiplier: 1, available: true },
          { id: 'v-det-10kg', label: 'Saco Industrial 10 kg', price: 21.8, price_wholesale: 20.5, stock_multiplier: 5, available: true },
        ],
        created_at: daysAgoIso(35),
      },
    ],
    product_lots: [
      {
        id: 'lot-demo-1',
        product_id: 'prod-6',
        product_name: 'Leche Entera UHT 1L',
        lot_code: 'L-2026-09A',
        expiry_date: daysFromNowYmd(8),
        days_left: 8,
        qty_remaining: 6,
        qty_initial: 24,
        cost: 1.35,
      },
      {
        id: 'lot-demo-2',
        product_id: 'prod-5',
        product_name: 'Queso Blanco Pasteurizado 1kg',
        lot_code: 'Q-2026-10B',
        expiry_date: daysFromNowYmd(19),
        days_left: 19,
        qty_remaining: 14,
        qty_initial: 20,
        cost: 5.4,
      },
    ],
    customers: [
      {
        id: 'cust-1',
        name: 'Abasto El Progreso',
        document: 'J-40123456-1',
        email: 'compras@elprogreso.com',
        phone: '0414-1234567',
        address: 'Calle 5 con Av. Bolívar, Centro',
        price_type: 'mayor',
        created_at: daysAgoIso(60),
      },
      {
        id: 'cust-2',
        name: 'María Gómez',
        document: 'V-18234567',
        email: 'maria@correo.com',
        phone: '0424-7654321',
        address: 'Urb. Los Pinos, Vereda 3',
        price_type: 'detal',
        created_at: daysAgoIso(55),
      },
      {
        id: 'cust-3',
        name: 'Panadería San José',
        document: 'J-41209876-3',
        email: 'admin@panaderiasanjose.com',
        phone: '0412-8901234',
        address: 'Av. Bolívar, Local 4',
        price_type: 'mayor',
        created_at: daysAgoIso(50),
      },
      {
        id: 'cust-4',
        name: 'Supermercado La Estación',
        document: 'J-31778210-9',
        email: 'recepcion@laestacion.com',
        phone: '0414-8823344',
        address: 'Av. Libertador, Esquina Norte',
        price_type: 'mayor',
        created_at: daysAgoIso(45),
      },
      {
        id: 'cust-5',
        name: 'Cafetería Central',
        document: 'J-40551290-2',
        email: 'pedidos@cafeteriacentral.com',
        phone: '0424-3349911',
        address: 'Plaza Mayor, PB Local 2',
        price_type: 'mayor',
        created_at: daysAgoIso(40),
      },
    ],
    customer_credit: [
      { customer_id: 'cust-1', credit_limit: 800, credit_days: 15 },
      { customer_id: 'cust-2', credit_limit: 150, credit_days: 7 },
      { customer_id: 'cust-3', credit_limit: 1000, credit_days: 15 },
      { customer_id: 'cust-4', credit_limit: 1500, credit_days: 30 },
      { customer_id: 'cust-5', credit_limit: 400, credit_days: 15 },
    ],
    customer_locations: [
      { customer_id: 'cust-1', lat: 10.488, lng: -66.879, updated_at: daysAgoIso(10) },
      { customer_id: 'cust-2', lat: 10.495, lng: -66.865, updated_at: daysAgoIso(10) },
      { customer_id: 'cust-3', lat: 10.482, lng: -66.888, updated_at: daysAgoIso(10) },
      { customer_id: 'cust-4', lat: 10.501, lng: -66.872, updated_at: daysAgoIso(10) },
      { customer_id: 'cust-5', lat: 10.491, lng: -66.854, updated_at: daysAgoIso(10) },
    ],
    visits: [
      {
        id: 'vis-demo-1',
        seller_id: 'demo-seller-1',
        seller_name: 'Carlos Méndez',
        customer_id: 'cust-1',
        sale_id: 'sale-demo-1',
        kind: 'venta',
        lat: 10.4881,
        lng: -66.8791,
        accuracy_m: 12,
        gps_status: 'ok',
        at_establishment: true,
        note: 'Reposición semanal de café y arroz',
        distance_to_customer_m: 15,
        flag: 'ok',
        created_at: daysAgoIso(0, 1),
      },
      {
        id: 'vis-demo-2',
        seller_id: 'demo-seller-1',
        seller_name: 'Carlos Méndez',
        customer_id: 'cust-3',
        sale_id: 'sale-demo-2',
        kind: 'venta',
        lat: 10.4821,
        lng: -66.8879,
        accuracy_m: 18,
        gps_status: 'ok',
        at_establishment: true,
        note: 'Pedido mayorista de harina y queso',
        distance_to_customer_m: 19,
        flag: 'ok',
        created_at: daysAgoIso(0, 2),
      },
      {
        id: 'vis-demo-3',
        seller_id: 'demo-seller-2',
        seller_name: 'Lucía Rojas',
        customer_id: 'cust-5',
        sale_id: null,
        kind: 'visita',
        lat: 10.4912,
        lng: -66.8541,
        accuracy_m: 14,
        gps_status: 'ok',
        at_establishment: true,
        note: 'Revisión de inventario; comprará el jueves',
        distance_to_customer_m: 22,
        flag: 'ok',
        created_at: daysAgoIso(0, 3),
      },
    ],
    suppliers: [
      {
        id: 'sup-1',
        name: 'Distribuidora Nacional C.A.',
        document: 'J-30987654-0',
        email: 'ventas@distribuidora.com',
        phone: '0212-5551234',
        address: 'Zona Industrial Norte, Galpón 4',
        created_at: daysAgoIso(60),
      },
      {
        id: 'sup-2',
        name: 'Molinos del Sur C.A.',
        document: 'J-31445566-8',
        email: 'cobranzas@molinosdelsur.com',
        phone: '0241-8892200',
        address: 'Zona Industrial Sur, Parcela 9',
        created_at: daysAgoIso(60),
      },
      {
        id: 'sup-3',
        name: 'Lácteos La Pradera C.A.',
        document: 'J-30711223-4',
        email: 'despachos@lapradera.com',
        phone: '0251-4421900',
        address: 'Vía Agroindustrial Km 8',
        created_at: daysAgoIso(45),
      },
    ],
    sales: [
      {
        id: 'sale-demo-1',
        customer_id: 'cust-1',
        customer_name: 'Abasto El Progreso',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 6, price: 5.8, subtotal: 34.8 },
          { product_id: 'prod-7', product_name: 'Arroz Blanco Extra 1kg', quantity: 24, price: 1.38, subtotal: 33.12 },
        ],
        subtotal: 67.92,
        tax_rate: 0,
        tax_amount: 0,
        total: 67.92,
        payment_method: 'efectivo',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-1',
        created_at: daysAgoIso(0, 0.4),
      },
      {
        id: 'sale-demo-2',
        customer_id: 'cust-3',
        customer_name: 'Panadería San José',
        items: [
          { product_id: 'prod-3', product_name: 'Harina de Maíz Precocida 1kg', quantity: 30, price: 1.25, subtotal: 37.5 },
          { product_id: 'prod-5', product_name: 'Queso Blanco Pasteurizado 1kg', quantity: 5, price: 7.1, subtotal: 35.5 },
        ],
        subtotal: 73.0,
        tax_rate: 0,
        tax_amount: 0,
        total: 73.0,
        payment_method: 'transferencia',
        status: 'completada',
        channel: 'mostrador',
        warehouse_id: 'wh-demo-2',
        branch_id: 'br-demo-2',
        created_at: daysAgoIso(0, 1.5),
      },
      {
        id: 'sale-demo-3',
        customer_id: 'cust-2',
        customer_name: 'María Gómez',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 2, price: 6.5, subtotal: 13.0 },
          { product_id: 'prod-8', product_name: 'Detergente Multiuso 2kg', quantity: 1, price: 4.9, subtotal: 4.9 },
        ],
        subtotal: 17.9,
        tax_rate: 0,
        tax_amount: 0,
        total: 17.9,
        payment_method: 'fiado',
        due_date: daysFromNowYmd(7),
        status: 'pendiente',
        channel: 'mostrador',
        warehouse_id: 'wh-demo-2',
        branch_id: 'br-demo-2',
        created_at: daysAgoIso(0, 3),
      },
      {
        id: 'sale-demo-yesterday-1',
        customer_id: 'cust-4',
        customer_name: 'Supermercado La Estación',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 12, price: 5.8, subtotal: 69.6 },
          { product_id: 'prod-8', product_name: 'Detergente Multiuso 2kg', quantity: 8, price: 4.4, subtotal: 35.2 },
        ],
        subtotal: 104.8,
        tax_rate: 0,
        tax_amount: 0,
        total: 104.8,
        payment_method: 'efectivo',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-1',
        warehouse_id: 'wh-demo-1',
        branch_id: 'br-demo-1',
        created_at: daysAgoIso(1, 2),
      },
      {
        id: 'sale-demo-yesterday-2',
        customer_id: 'cust-5',
        customer_name: 'Cafetería Central',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 8, price: 5.8, subtotal: 46.4 },
        ],
        subtotal: 46.4,
        tax_rate: 0,
        tax_amount: 0,
        total: 46.4,
        payment_method: 'tarjeta',
        status: 'completada',
        channel: 'mostrador',
        warehouse_id: 'wh-demo-2',
        branch_id: 'br-demo-2',
        created_at: daysAgoIso(1, 5),
      },
      {
        id: 'sale-demo-3d',
        customer_id: 'cust-3',
        customer_name: 'Panadería San José',
        items: [
          { product_id: 'prod-3', product_name: 'Harina de Maíz Precocida 1kg', quantity: 80, price: 1.25, subtotal: 100.0 },
        ],
        subtotal: 100.0,
        tax_rate: 0,
        tax_amount: 0,
        total: 100.0,
        payment_method: 'transferencia',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-1',
        warehouse_id: 'wh-demo-1',
        branch_id: 'br-demo-1',
        created_at: daysAgoIso(3, 1),
      },
      {
        id: 'sale-demo-5d',
        customer_id: 'cust-4',
        customer_name: 'Supermercado La Estación',
        items: [
          { product_id: 'prod-5', product_name: 'Queso Blanco Pasteurizado 1kg', quantity: 10, price: 7.1, subtotal: 71.0 },
          { product_id: 'prod-7', product_name: 'Arroz Blanco Extra 1kg', quantity: 24, price: 1.38, subtotal: 33.12 },
        ],
        subtotal: 104.12,
        tax_rate: 0,
        tax_amount: 0,
        total: 104.12,
        payment_method: 'tarjeta',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-2',
        warehouse_id: 'wh-demo-3',
        branch_id: 'br-demo-3',
        created_at: daysAgoIso(5, 2),
      },
      {
        id: 'sale-demo-fiado-overdue',
        customer_id: 'cust-1',
        customer_name: 'Abasto El Progreso',
        items: [
          { product_id: 'prod-2', product_name: 'Aceite Vegetal Puro 1L', quantity: 24, price: 2.95, subtotal: 70.8 },
          { product_id: 'prod-6', product_name: 'Leche Entera UHT 1L', quantity: 12, price: 1.85, subtotal: 22.2 },
        ],
        subtotal: 93.0,
        tax_rate: 0,
        tax_amount: 0,
        total: 93.0,
        payment_method: 'fiado',
        due_date: daysFromNowYmd(-4),
        status: 'pendiente',
        channel: 'ruta',
        seller_id: 'demo-seller-2',
        created_at: daysAgoIso(19, 2),
      },
      {
        id: 'sale-demo-8d',
        customer_id: 'cust-5',
        customer_name: 'Cafetería Central',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 10, price: 5.8, subtotal: 58.0 },
          { product_id: 'prod-6', product_name: 'Leche Entera UHT 1L', quantity: 12, price: 1.85, subtotal: 22.2 },
        ],
        subtotal: 80.2,
        tax_rate: 0,
        tax_amount: 0,
        total: 80.2,
        payment_method: 'efectivo',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-2',
        created_at: daysAgoIso(8, 3),
      },
      {
        id: 'sale-demo-12d',
        customer_id: 'cust-3',
        customer_name: 'Panadería San José',
        items: [
          { product_id: 'prod-3', product_name: 'Harina de Maíz Precocida 1kg', quantity: 60, price: 1.25, subtotal: 75.0 },
          { product_id: 'prod-5', product_name: 'Queso Blanco Pasteurizado 1kg', quantity: 8, price: 7.1, subtotal: 56.8 },
        ],
        subtotal: 131.8,
        tax_rate: 0,
        tax_amount: 0,
        total: 131.8,
        payment_method: 'transferencia',
        status: 'completada',
        channel: 'ruta',
        seller_id: 'demo-seller-1',
        created_at: daysAgoIso(12, 2),
      },
    ],
    purchases: [
      {
        id: 'pur-demo-1',
        supplier_id: 'sup-1',
        supplier_name: 'Distribuidora Nacional C.A.',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 30, cost: 4.2, subtotal: 126.0 },
          { product_id: 'prod-7', product_name: 'Arroz Blanco Extra 1kg', quantity: 50, cost: 1.02, subtotal: 51.0 },
        ],
        total: 177.0,
        status: 'recibida',
        payment_method: 'credito',
        credit_days: 30,
        due_date: daysFromNowYmd(14),
        branch_id: 'br-demo-1',
        warehouse_id: 'wh-demo-1',
        created_at: daysAgoIso(5),
      },
      {
        id: 'pur-demo-2',
        supplier_id: 'sup-2',
        supplier_name: 'Molinos del Sur C.A.',
        items: [
          { product_id: 'prod-3', product_name: 'Harina de Maíz Precocida 1kg', quantity: 80, cost: 0.95, subtotal: 76.0 },
        ],
        total: 76.0,
        status: 'recibida',
        payment_method: 'credito',
        credit_days: 15,
        due_date: daysFromNowYmd(-3),
        branch_id: 'br-demo-1',
        warehouse_id: 'wh-demo-1',
        created_at: daysAgoIso(18),
      },
      {
        id: 'pur-demo-3',
        supplier_id: 'sup-3',
        supplier_name: 'Lácteos La Pradera C.A.',
        items: [
          { product_id: 'prod-5', product_name: 'Queso Blanco Pasteurizado 1kg', quantity: 20, cost: 5.4, subtotal: 108.0 },
        ],
        total: 108.0,
        status: 'recibida',
        payment_method: 'transferencia',
        credit_days: null,
        due_date: null,
        branch_id: 'br-demo-2',
        warehouse_id: 'wh-demo-2',
        created_at: daysAgoIso(9),
      },
    ],
    cash_entries: [
      {
        id: 'cash-1',
        type: 'ingreso',
        amount: 67.92,
        description: 'Venta FAC-00109 · Abasto El Progreso',
        reference_type: 'sale',
        reference_id: 'sale-demo-1',
        created_at: daysAgoIso(0, 0.4),
      },
      {
        id: 'cash-2',
        type: 'ingreso',
        amount: 104.8,
        description: 'Venta FAC-00107 · Supermercado La Estación',
        reference_type: 'sale',
        reference_id: 'sale-demo-yesterday-1',
        created_at: daysAgoIso(1, 2),
      },
      {
        id: 'cash-3',
        type: 'egreso',
        amount: 18.5,
        description: 'Gasto (Transporte y fletes) - Combustible ruta norte',
        reference_type: 'gasto',
        reference_id: 'exp-demo-2',
        created_at: daysAgoIso(1, 4),
      },
    ],
    cash_movements: [
      {
        id: 'cash-1',
        type: 'ingreso',
        amount: 67.92,
        description: 'Venta FAC-00109 · Abasto El Progreso',
        reference_type: 'sale',
        reference_id: 'sale-demo-1',
        created_at: daysAgoIso(0, 0.4),
      },
      {
        id: 'cash-2',
        type: 'ingreso',
        amount: 104.8,
        description: 'Venta FAC-00107 · Supermercado La Estación',
        reference_type: 'sale',
        reference_id: 'sale-demo-yesterday-1',
        created_at: daysAgoIso(1, 2),
      },
      {
        id: 'cash-3',
        type: 'egreso',
        amount: 18.5,
        description: 'Gasto (Transporte y fletes) - Combustible ruta norte',
        reference_type: 'gasto',
        reference_id: 'exp-demo-2',
        created_at: daysAgoIso(1, 4),
      },
    ],
    kardex: [
      {
        id: 'kdx-1',
        product_id: 'prod-1',
        product_name: 'Café Molido Gourmet 500g',
        type: 'salida',
        quantity: 6,
        balance: 34,
        reference_type: 'venta',
        reference_id: 'sale-demo-1',
        created_at: daysAgoIso(0, 0.4),
      },
      {
        id: 'kdx-2',
        product_id: 'prod-3',
        product_name: 'Harina de Maíz Precocida 1kg',
        type: 'salida',
        quantity: 30,
        balance: 68,
        reference_type: 'venta',
        reference_id: 'sale-demo-2',
        created_at: daysAgoIso(0, 1.5),
      },
      {
        id: 'kdx-3',
        product_id: 'prod-1',
        product_name: 'Café Molido Gourmet 500g',
        type: 'entrada',
        quantity: 30,
        balance: 40,
        reference_type: 'compra',
        reference_id: 'pur-demo-1',
        created_at: daysAgoIso(5),
      },
    ],
    quotations: [
      {
        id: 'quot-demo-1',
        customer_id: 'cust-4',
        customer_name: 'Supermercado La Estación',
        items: [
          { product_id: 'prod-1', product_name: 'Café Molido Gourmet 500g', quantity: 24, price: 5.8, subtotal: 139.2 },
          { product_id: 'prod-3', product_name: 'Harina de Maíz Precocida 1kg', quantity: 60, price: 1.25, subtotal: 75.0 },
        ],
        total: 214.2,
        status: 'enviada',
        valid_until: daysFromNowYmd(7),
        created_at: daysAgoIso(1),
      },
      {
        id: 'quot-demo-2',
        customer_id: 'cust-5',
        customer_name: 'Cafetería Central',
        items: [
          { product_id: 'prod-5', product_name: 'Queso Blanco Pasteurizado 1kg', quantity: 8, price: 7.1, subtotal: 56.8 },
        ],
        total: 56.8,
        status: 'aprobada',
        valid_until: daysFromNowYmd(5),
        created_at: daysAgoIso(2),
      },
    ],
    route_dispatches: [
      {
        id: 'disp-demo-1',
        seller_id: 'demo-seller-1',
        seller_name: 'Carlos Méndez',
        dispatch_date: daysFromNowYmd(0),
        vehicle_label: 'Moto carga placa AB123CD',
        zone: 'Ruta Norte y Centro',
        opening_cash: 30,
        status: 'abierto',
        sales_cash: 67.92,
        sales_bank: 0,
        sales_credit: 0,
        collections_cash: 0,
        collections_bank: 0,
        expected_cash: 97.92,
        delivered_cash: null,
        cash_diff: null,
        notes: 'Salida 8:00 AM · Ruta centro comercial y abastos',
        closed_at: null,
        closed_by_name: null,
        created_by_name: 'Valentina Morales',
        created_at: daysAgoIso(0, 4),
        items: [
          {
            id: 'di-1',
            product_id: 'prod-1',
            product_name: 'Café Molido Gourmet 500g',
            sku: '75910001',
            unit: 'unidad',
            unit_price: 5.8,
            qty_loaded: 20,
            qty_sold: 6,
            qty_expected_return: 14,
            qty_returned: null,
            qty_diff: null,
          },
          {
            id: 'di-2',
            product_id: 'prod-7',
            product_name: 'Arroz Blanco Extra 1kg',
            sku: '75910007',
            unit: 'unidad',
            unit_price: 1.38,
            qty_loaded: 48,
            qty_sold: 24,
            qty_expected_return: 24,
            qty_returned: null,
            qty_diff: null,
          },
        ],
      },
    ],
    payroll_movements: [
      {
        id: 'pm-demo-1',
        user_id: 'demo-seller-1',
        member_name: 'Carlos Méndez',
        type: 'adelanto',
        amount: 40,
        method: 'transferencia',
        movement_date: daysFromNowYmd(-3),
        reason: 'Adelanto quincenal autorizado',
        status: 'pendiente',
        expense_id: null,
        payment_id: null,
        created_by_name: 'Valentina Morales',
        created_at: daysAgoIso(3),
      },
      {
        id: 'pm-demo-2',
        user_id: 'demo-seller-2',
        member_name: 'Lucía Rojas',
        type: 'bono',
        amount: 25,
        method: 'transferencia',
        movement_date: daysFromNowYmd(-2),
        reason: 'Bono cumplimiento clientes mayoristas',
        status: 'pendiente',
        expense_id: null,
        payment_id: null,
        created_by_name: 'Valentina Morales',
        created_at: daysAgoIso(2),
      },
    ],
    payroll_payments: [
      {
        id: 'pp-demo-1',
        user_id: 'demo-seller-1',
        member_name: 'Carlos Méndez',
        period_from: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        period_to: daysFromNowYmd(-4),
        payment_date: daysFromNowYmd(-4),
        base_amount: 140,
        sales_amount: 920,
        commission_pct: 5,
        commission_amount: 46,
        bonuses_amount: 0,
        deductions_amount: 0,
        advances_deducted: 0,
        net_paid: 186,
        method: 'transferencia',
        reference: 'NOM-1042',
        notes: 'Primera quincena y comisiones liquidadas',
        status: 'activo',
        expense_id: null,
        created_by_name: 'Valentina Morales',
        created_at: daysAgoIso(4),
      },
    ],
    branches: [
      {
        id: 'br-demo-1',
        company_id: DEMO_COMPANY_ID,
        name: 'Sede Central y Centro de Distribución',
        code: 'SUC-001',
        address: 'Av. Las Américas, Galpón 12, Zona Industrial',
        phone: '+58 412-5550140',
        email: 'central@losandesdemo.com',
        is_main: true,
        active: true,
        created_at: daysAgoIso(90),
      },
      {
        id: 'br-demo-2',
        company_id: DEMO_COMPANY_ID,
        name: 'Sucursal Comercial Centro',
        code: 'SUC-002',
        address: 'Calle 10 con Carrera 5, Local PB-2, Casco Central',
        phone: '+58 412-5550188',
        email: 'centro@losandesdemo.com',
        is_main: false,
        active: true,
        created_at: daysAgoIso(60),
      },
      {
        id: 'br-demo-3',
        company_id: DEMO_COMPANY_ID,
        name: 'Agencia Norte Mayorista',
        code: 'SUC-003',
        address: 'Av. Intercomunal Norte, Centro Empresarial Local 4',
        phone: '+58 414-3219876',
        email: 'norte@losandesdemo.com',
        is_main: false,
        active: true,
        created_at: daysAgoIso(45),
      },
    ],
    warehouses: [
      {
        id: 'wh-demo-1',
        company_id: DEMO_COMPANY_ID,
        branch_id: 'br-demo-1',
        name: 'Bodega Principal Mayorista',
        code: 'BOD-001',
        address: 'Galpón 12 · Nave A',
        warehouse_type: 'principal',
        active: true,
        created_at: daysAgoIso(90),
      },
      {
        id: 'wh-demo-2',
        company_id: DEMO_COMPANY_ID,
        branch_id: 'br-demo-2',
        name: 'Almacén Piso de Venta Centro',
        code: 'BOD-002',
        address: 'Local PB-2 · Trastienda',
        warehouse_type: 'general',
        active: true,
        created_at: daysAgoIso(60),
      },
      {
        id: 'wh-demo-3',
        company_id: DEMO_COMPANY_ID,
        branch_id: 'br-demo-3',
        name: 'Bodega Despacho Ruta Norte',
        code: 'BOD-003',
        address: 'Centro Empresarial Norte · Muelle 2',
        warehouse_type: 'producto_terminado',
        active: true,
        created_at: daysAgoIso(45),
      },
      {
        id: 'wh-demo-4',
        company_id: DEMO_COMPANY_ID,
        branch_id: 'br-demo-1',
        name: 'Área de Control y Devoluciones',
        code: 'BOD-004',
        address: 'Galpón 12 · Anexo Calidad',
        warehouse_type: 'devoluciones',
        active: true,
        created_at: daysAgoIso(45),
      },
    ],
    warehouse_stock: [
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-1', quantity: 20, reserved_quantity: 4, updated_at: daysAgoIso(0, 1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-1', quantity: 8, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-3', product_id: 'prod-1', quantity: 6, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-2', quantity: 3, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-2', quantity: 2, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-3', quantity: 40, reserved_quantity: 10, updated_at: daysAgoIso(0, 2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-3', quantity: 18, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-3', product_id: 'prod-3', quantity: 10, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-4', quantity: 0, reserved_quantity: 0, updated_at: daysAgoIso(3) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-4', quantity: 0, reserved_quantity: 0, updated_at: daysAgoIso(3) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-5', quantity: 8, reserved_quantity: 0, updated_at: daysAgoIso(0, 3) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-5', quantity: 4, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-3', product_id: 'prod-5', quantity: 2, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-6', quantity: 4, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-6', quantity: 2, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-7', quantity: 30, reserved_quantity: 0, updated_at: daysAgoIso(0, 1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-7', quantity: 12, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-3', product_id: 'prod-7', quantity: 10, reserved_quantity: 0, updated_at: daysAgoIso(1) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-1', product_id: 'prod-8', quantity: 14, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-2', product_id: 'prod-8', quantity: 5, reserved_quantity: 0, updated_at: daysAgoIso(2) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-3', product_id: 'prod-8', quantity: 2, reserved_quantity: 0, updated_at: daysAgoIso(3) },
      { company_id: DEMO_COMPANY_ID, warehouse_id: 'wh-demo-4', product_id: 'prod-8', quantity: 1, reserved_quantity: 0, updated_at: daysAgoIso(4) },
    ],
    warehouse_movements: [
      {
        id: 'wm-demo-1',
        company_id: DEMO_COMPANY_ID,
        warehouse_id: 'wh-demo-1',
        product_id: 'prod-1',
        movement_type: 'exit',
        quantity_delta: -6,
        quantity_before: 26,
        quantity_after: 20,
        reference_type: 'inventory_transfer',
        reference_id: 'trf-demo-1',
        notes: 'Despacho de traslado hacia Sucursal Centro',
        created_by: 'demo-almacen-1',
        created_at: daysAgoIso(0, 2.5),
      },
      {
        id: 'wm-demo-2',
        company_id: DEMO_COMPANY_ID,
        warehouse_id: 'wh-demo-1',
        product_id: 'prod-3',
        movement_type: 'exit',
        quantity_delta: -12,
        quantity_before: 52,
        quantity_after: 40,
        reference_type: 'inventory_transfer',
        reference_id: 'trf-demo-1',
        notes: 'Despacho de traslado hacia Sucursal Centro',
        created_by: 'demo-almacen-1',
        created_at: daysAgoIso(0, 2.5),
      },
      {
        id: 'wm-demo-3',
        company_id: DEMO_COMPANY_ID,
        warehouse_id: 'wh-demo-3',
        product_id: 'prod-7',
        movement_type: 'entry',
        quantity_delta: 10,
        quantity_before: 0,
        quantity_after: 10,
        reference_type: 'inventory_transfer',
        reference_id: 'trf-demo-2',
        notes: 'Recepción conforme en Agencia Norte',
        created_by: 'demo-almacen-1',
        created_at: daysAgoIso(2, 3),
      },
    ],
    inventory_transfers: [
      {
        id: 'trf-demo-1',
        company_id: DEMO_COMPANY_ID,
        source_warehouse_id: 'wh-demo-1',
        destination_warehouse_id: 'wh-demo-2',
        status: 'in_transit',
        notes: 'Reposición de mostrador para fin de semana · Guía #TR-019',
        created_by: 'demo-almacen-1',
        approved_by: 'demo-dueno-1',
        received_by: null,
        created_at: daysAgoIso(0, 3),
        approved_at: daysAgoIso(0, 2.5),
        received_at: null,
        updated_at: daysAgoIso(0, 2.5),
      },
      {
        id: 'trf-demo-2',
        company_id: DEMO_COMPANY_ID,
        source_warehouse_id: 'wh-demo-1',
        destination_warehouse_id: 'wh-demo-3',
        status: 'received',
        notes: 'Dotación semanal Ruta Norte · Guía #TR-018',
        created_by: 'demo-almacen-1',
        approved_by: 'demo-dueno-1',
        received_by: 'demo-admin-emp-1',
        created_at: daysAgoIso(2, 5),
        approved_at: daysAgoIso(2, 4),
        received_at: daysAgoIso(2, 3),
        updated_at: daysAgoIso(2, 3),
      },
      {
        id: 'trf-demo-3',
        company_id: DEMO_COMPANY_ID,
        source_warehouse_id: 'wh-demo-1',
        destination_warehouse_id: 'wh-demo-3',
        status: 'draft',
        notes: 'Solicitud de refuerzo lácteos y café para clientes mayoristas',
        created_by: 'demo-admin-emp-1',
        approved_by: null,
        received_by: null,
        created_at: daysAgoIso(0, 1),
        approved_at: null,
        received_at: null,
        updated_at: daysAgoIso(0, 1),
      },
    ],
    inventory_transfer_items: [
      {
        id: 'trfi-1',
        company_id: DEMO_COMPANY_ID,
        transfer_id: 'trf-demo-1',
        product_id: 'prod-1',
        quantity: 6,
        received_quantity: 0,
        damaged_quantity: 0,
        missing_quantity: 0,
        notes: null,
        receipt_notes: null,
      },
      {
        id: 'trfi-2',
        company_id: DEMO_COMPANY_ID,
        transfer_id: 'trf-demo-1',
        product_id: 'prod-3',
        quantity: 12,
        received_quantity: 0,
        damaged_quantity: 0,
        missing_quantity: 0,
        notes: null,
        receipt_notes: null,
      },
      {
        id: 'trfi-3',
        company_id: DEMO_COMPANY_ID,
        transfer_id: 'trf-demo-2',
        product_id: 'prod-7',
        quantity: 10,
        received_quantity: 10,
        damaged_quantity: 0,
        missing_quantity: 0,
        notes: null,
        receipt_notes: 'Recibido completo sin novedades',
      },
      {
        id: 'trfi-4',
        company_id: DEMO_COMPANY_ID,
        transfer_id: 'trf-demo-3',
        product_id: 'prod-5',
        quantity: 3,
        received_quantity: 0,
        damaged_quantity: 0,
        missing_quantity: 0,
        notes: 'Despachar en cava refrigerada',
        receipt_notes: null,
      },
    ],
    warehouse_stock_reservations: [
      {
        id: 'resv-demo-1',
        company_id: DEMO_COMPANY_ID,
        warehouse_id: 'wh-demo-1',
        product_id: 'prod-1',
        quantity: 4,
        status: 'active',
        reference_type: 'cotizacion',
        reference_id: 'quot-demo-1',
        expires_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
        created_at: daysAgoIso(0, 1.5),
      },
      {
        id: 'resv-demo-2',
        company_id: DEMO_COMPANY_ID,
        warehouse_id: 'wh-demo-1',
        product_id: 'prod-3',
        quantity: 10,
        status: 'active',
        reference_type: 'pedido_mayorista',
        reference_id: 'quot-demo-1',
        expires_at: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
        created_at: daysAgoIso(0, 1.2),
      },
    ],
    devolutions: [],
    purchase_devolutions: [],
    expense_categories: [
      { id: 'ec-1', name: 'Arriendo y local', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-2', name: 'Servicios públicos', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-3', name: 'Nómina y comisiones', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-4', name: 'Transporte y fletes', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-5', name: 'Mantenimiento y reparaciones', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-6', name: 'Papelería y aseo', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-7', name: 'Publicidad y ventas', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-8', name: 'Impuestos y tasas', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-9', name: 'Comisiones bancarias', account_id: null, active: true, created_at: nowIso() },
      { id: 'ec-10', name: 'Otros gastos', account_id: null, active: true, created_at: nowIso() },
    ],
    expenses: [
      {
        id: 'exp-demo-1',
        category_id: 'ec-2',
        category_name: 'Servicios públicos',
        amount: 32.0,
        method: 'transferencia',
        expense_date: daysFromNowYmd(0),
        description: 'Internet fibra óptica y telefonía sede principal',
        beneficiary: 'FibraNet Empresarial',
        reference: 'TRF-8821',
        status: 'activo',
        created_by_name: 'Valentina Morales',
        branch_id: 'br-demo-1',
        created_at: daysAgoIso(0, 2),
      },
      {
        id: 'exp-demo-2',
        category_id: 'ec-4',
        category_name: 'Transporte y fletes',
        amount: 18.5,
        method: 'efectivo',
        expense_date: daysFromNowYmd(-1),
        description: 'Combustible despacho Ruta Norte',
        beneficiary: 'Estación Central',
        reference: 'EFE-104',
        status: 'activo',
        created_by_name: 'Valentina Morales',
        branch_id: 'br-demo-3',
        created_at: daysAgoIso(1, 4),
      },
      {
        id: 'exp-demo-3',
        category_id: 'ec-1',
        category_name: 'Arriendo y local',
        amount: 85.0,
        method: 'transferencia',
        expense_date: daysFromNowYmd(-2),
        description: 'Canon mensual local PB-2 Casco Central',
        beneficiary: 'Inmobiliaria Los Andes',
        reference: 'TRF-8790',
        status: 'activo',
        created_by_name: 'Andrés Castellanos',
        branch_id: 'br-demo-2',
        created_at: daysAgoIso(2, 3),
      },
      {
        id: 'exp-demo-4',
        category_id: 'ec-7',
        category_name: 'Publicidad y ventas',
        amount: 24.0,
        method: 'tarjeta',
        expense_date: daysFromNowYmd(-3),
        description: 'Catálogo mayorista y pauta promocional mensual',
        beneficiary: 'Agencia Creativa Sur',
        reference: 'TDC-4412',
        status: 'activo',
        created_by_name: 'Valentina Morales',
        branch_id: null,
        created_at: daysAgoIso(3, 5),
      },
    ],
    financial_budgets: [
      {
        id: 'fb-demo-1',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: null,
        kind: 'ingreso_ventas',
        category_name: 'Facturación comercial consolidada',
        budget_amount: 1200,
        notes: 'Meta mensual sumando mostrador y rutas mayoristas',
        created_at: daysAgoIso(15),
      },
      {
        id: 'fb-demo-2',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: null,
        kind: 'costo_compras',
        category_name: 'Reposición de inventario y compras',
        budget_amount: 650,
        notes: 'Techo de abastecimiento ordinario del mes',
        created_at: daysAgoIso(15),
      },
      {
        id: 'fb-demo-3',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: 'br-demo-2',
        kind: 'gasto_operativo',
        category_name: 'Arriendo y local',
        budget_amount: 90,
        notes: 'Canon local Sucursal Centro',
        created_at: daysAgoIso(15),
      },
      {
        id: 'fb-demo-4',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: null,
        kind: 'gasto_operativo',
        category_name: 'Servicios públicos',
        budget_amount: 55,
        notes: 'Fibra óptica, energía y telefonía',
        created_at: daysAgoIso(15),
      },
      {
        id: 'fb-demo-5',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: null,
        kind: 'gasto_operativo',
        category_name: 'Transporte y fletes',
        budget_amount: 60,
        notes: 'Combustible y despachos de ruta',
        created_at: daysAgoIso(15),
      },
      {
        id: 'fb-demo-6',
        company_id: DEMO_COMPANY_ID,
        period_month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        branch_id: null,
        kind: 'nomina',
        category_name: 'Nómina fija y comisiones comerciales',
        budget_amount: 320,
        notes: 'Sueldos base y comisiones estimadas del equipo',
        created_at: daysAgoIso(15),
      },
    ],
    purchase_orders: [
      {
        id: 'po-demo-1',
        company_id: DEMO_COMPANY_ID,
        po_number: 'OC-0041',
        supplier_id: 'sup-1',
        supplier_name: 'Distribuidora Nacional C.A.',
        branch_id: 'br-demo-1',
        target_warehouse_id: 'wh-demo-1',
        status: 'sent',
        payment_terms: 'credito',
        credit_days: 30,
        expected_date: daysFromNowYmd(2),
        subtotal: 237.6,
        total: 237.6,
        notes: 'Reposición quincenal de café gourmet y arroz extra para galpón central',
        linked_purchase_id: null,
        created_by_name: 'Marco Paredes',
        approved_by_name: 'Valentina Morales',
        approved_at: daysAgoIso(1, 3),
        received_at: null,
        created_at: daysAgoIso(1, 5),
      },
      {
        id: 'po-demo-2',
        company_id: DEMO_COMPANY_ID,
        po_number: 'OC-0040',
        supplier_id: 'sup-3',
        supplier_name: 'Lácteos La Pradera C.A.',
        branch_id: 'br-demo-2',
        target_warehouse_id: 'wh-demo-2',
        status: 'approved',
        payment_terms: 'credito',
        credit_days: 15,
        expected_date: daysFromNowYmd(5),
        subtotal: 162.0,
        total: 162.0,
        notes: 'Pedido refrigerado directo para piso de venta Sucursal Centro',
        linked_purchase_id: null,
        created_by_name: 'Andrés Castellanos',
        approved_by_name: 'Valentina Morales',
        approved_at: daysAgoIso(2, 1),
        received_at: null,
        created_at: daysAgoIso(2, 4),
      },
      {
        id: 'po-demo-3',
        company_id: DEMO_COMPANY_ID,
        po_number: 'OC-0039',
        supplier_id: 'sup-2',
        supplier_name: 'Molinos del Sur C.A.',
        branch_id: 'br-demo-1',
        target_warehouse_id: 'wh-demo-1',
        status: 'received',
        payment_terms: 'credito',
        credit_days: 15,
        expected_date: daysFromNowYmd(-16),
        subtotal: 76.0,
        total: 76.0,
        notes: 'Recepción conforme en Bodega Principal Mayorista',
        linked_purchase_id: 'pur-demo-2',
        created_by_name: 'Marco Paredes',
        approved_by_name: 'Valentina Morales',
        approved_at: daysAgoIso(19),
        received_at: daysAgoIso(18),
        created_at: daysAgoIso(19, 2),
      },
    ],
    purchase_order_items: [
      {
        id: 'poi-demo-1',
        company_id: DEMO_COMPANY_ID,
        po_id: 'po-demo-1',
        product_id: 'prod-1',
        product_name: 'Café Molido Gourmet 500g',
        sku: '75910001',
        ordered_qty: 36,
        received_qty: 0,
        rejected_qty: 0,
        unit_cost: 4.2,
      },
      {
        id: 'poi-demo-2',
        company_id: DEMO_COMPANY_ID,
        po_id: 'po-demo-1',
        product_id: 'prod-7',
        product_name: 'Arroz Blanco Extra 1kg',
        sku: '75910007',
        ordered_qty: 84,
        received_qty: 0,
        rejected_qty: 0,
        unit_cost: 1.03,
      },
      {
        id: 'poi-demo-3',
        company_id: DEMO_COMPANY_ID,
        po_id: 'po-demo-2',
        product_id: 'prod-5',
        product_name: 'Queso Blanco Pasteurizado 1kg',
        sku: '75910005',
        ordered_qty: 30,
        received_qty: 0,
        rejected_qty: 0,
        unit_cost: 5.4,
      },
      {
        id: 'poi-demo-4',
        company_id: DEMO_COMPANY_ID,
        po_id: 'po-demo-3',
        product_id: 'prod-3',
        product_name: 'Harina de Maíz Precocida 1kg',
        sku: '75910003',
        ordered_qty: 80,
        received_qty: 80,
        rejected_qty: 0,
        unit_cost: 0.95,
      },
    ],
    supplier_credit: [
      { supplier_id: 'sup-1', credit_limit: 2500, credit_days: 30 },
      { supplier_id: 'sup-2', credit_limit: 1500, credit_days: 15 },
      { supplier_id: 'sup-3', credit_limit: 1200, credit_days: 15 },
    ],
    supplier_payments: [],
    supplier_allocations: [],
    credit_payments: [],
    credit_allocations: [],
    cxp_settings: [{ id: 'cxp-1', account_id: 'acc-5' }],
    cxc_settings: [{ id: 'cxc-1', account_id: 'acc-3' }],
    acc_settings: [
      {
        id: 'acc-st-1',
        active: true,
        start_date: `${new Date().getFullYear()}-01-01`,
        timezone: 'America/Caracas',
        map: {
          caja: 'acc-1',
          bancos: 'acc-2',
          cxc: 'acc-3',
          inventario: 'acc-4',
          cxp: 'acc-5',
          capital: 'acc-6',
          ventas: 'acc-7',
          costo_ventas: 'acc-8',
          gastos: 'acc-9',
        },
      },
    ],
    acc_accounts: [
      { id: 'acc-1', code: '1101', name: 'Caja General', type: 'activo', nature: 'debito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-2', code: '1102', name: 'Bancos Moneda Nacional / Divisas', type: 'activo', nature: 'debito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-3', code: '1103', name: 'Cuentas por Cobrar Clientes', type: 'activo', nature: 'debito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-4', code: '1104', name: 'Inventario de Mercancías', type: 'activo', nature: 'debito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-5', code: '2101', name: 'Cuentas por Pagar Proveedores', type: 'pasivo', nature: 'credito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-6', code: '3101', name: 'Capital Social y Aportes', type: 'patrimonio', nature: 'credito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-7', code: '4101', name: 'Ingresos por Ventas de Mercancía', type: 'ingreso', nature: 'credito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-8', code: '5101', name: 'Costo de Mercancía Vendida', type: 'costo', nature: 'debito', parent_id: null, is_postable: true, active: true },
      { id: 'acc-9', code: '6101', name: 'Gastos Operativos y Servicios', type: 'gasto', nature: 'debito', parent_id: null, is_postable: true, active: true },
    ],
    acc_entries: [
      {
        id: 'ae-1',
        number: 'ASI-0001',
        entry_date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
        description: 'Apertura operativa e inventario inicial de demostración',
        status: 'contabilizado',
        source_type: 'manual',
      },
      {
        id: 'ae-2',
        number: 'ASI-0002',
        entry_date: daysFromNowYmd(-3),
        description: 'Ventas consolidadas de ruta y mostrador',
        status: 'contabilizado',
        source_type: 'venta',
      },
      {
        id: 'ae-3',
        number: 'ASI-0003',
        entry_date: daysFromNowYmd(0),
        description: 'Registro de servicios de internet y gastos operativos',
        status: 'contabilizado',
        source_type: 'gasto',
      },
    ],
    acc_lines: [
      { id: 'al-1', entry_id: 'ae-1', account_id: 'acc-1', debit: 450, credit: 0, memo: 'Efectivo inicial en caja', acc_accounts: { code: '1101', name: 'Caja General' } },
      { id: 'al-2', entry_id: 'ae-1', account_id: 'acc-2', debit: 1200, credit: 0, memo: 'Saldo operativo en bancos', acc_accounts: { code: '1102', name: 'Bancos Moneda Nacional / Divisas' } },
      { id: 'al-3', entry_id: 'ae-1', account_id: 'acc-4', debit: 850, credit: 0, memo: 'Inventario inicial valorizado', acc_accounts: { code: '1104', name: 'Inventario de Mercancías' } },
      { id: 'al-4', entry_id: 'ae-1', account_id: 'acc-5', debit: 0, credit: 253, memo: 'Facturas proveedores vigentes', acc_accounts: { code: '2101', name: 'Cuentas por Pagar Proveedores' } },
      { id: 'al-5', entry_id: 'ae-1', account_id: 'acc-6', debit: 0, credit: 2247, memo: 'Patrimonio neto inicial', acc_accounts: { code: '3101', name: 'Capital Social y Aportes' } },
      { id: 'al-6', entry_id: 'ae-2', account_id: 'acc-2', debit: 710, credit: 0, memo: 'Cobros ventas en bancos y caja', acc_accounts: { code: '1102', name: 'Bancos Moneda Nacional / Divisas' } },
      { id: 'al-7', entry_id: 'ae-2', account_id: 'acc-3', debit: 110.9, credit: 0, memo: 'Ventas a crédito clientes', acc_accounts: { code: '1103', name: 'Cuentas por Cobrar Clientes' } },
      { id: 'al-8', entry_id: 'ae-2', account_id: 'acc-7', debit: 0, credit: 820.9, memo: 'Ingresos brutos por ventas', acc_accounts: { code: '4101', name: 'Ingresos por Ventas de Mercancía' } },
      { id: 'al-9', entry_id: 'ae-2', account_id: 'acc-8', debit: 534.5, credit: 0, memo: 'Costo de mercancía despachada', acc_accounts: { code: '5101', name: 'Costo de Mercancía Vendida' } },
      { id: 'al-10', entry_id: 'ae-2', account_id: 'acc-4', debit: 0, credit: 534.5, memo: 'Descargo de inventario', acc_accounts: { code: '1104', name: 'Inventario de Mercancías' } },
      { id: 'al-11', entry_id: 'ae-3', account_id: 'acc-9', debit: 50.5, credit: 0, memo: 'Servicios y fletes de ruta', acc_accounts: { code: '6101', name: 'Gastos Operativos y Servicios' } },
      { id: 'al-12', entry_id: 'ae-3', account_id: 'acc-2', debit: 0, credit: 50.5, memo: 'Pago por transferencia y caja', acc_accounts: { code: '1102', name: 'Bancos Moneda Nacional / Divisas' } },
    ],
    acc_closings: [],
    support_tickets: [
      {
        id: 'sup-tk-1',
        ticket_number: 'SOP-1042',
        company_id: DEMO_COMPANY_ID,
        company_name: 'Distribuidora Los Andes C.A.',
        user_id: 'demo-seller-1',
        user_name: 'Carlos Méndez',
        user_email: 'carlos.ruta@losandesdemo.com',
        user_role: 'vendedor',
        category: 'ventas_pos',
        priority: 'alta',
        subject: 'Verificación de sincronización de pedido a crédito en Ruta Norte',
        description: 'Registré un pedido mayorista con señal intermitente en Ruta Norte y deseo que el equipo técnico valide que el saldo del cliente haya quedado conciliado en mi sesión.',
        module_page: 'pos',
        session_authorized: true,
        authorization_code: 'AUT-8421-IP',
        authorized_at: daysAgoIso(0, 1.2),
        authorized_until: new Date(Date.now() + 22 * 3600 * 1000).toISOString(),
        revoked_at: null,
        authorization_scope: 'intervencion_asistida',
        session_snapshot: {
          captured_at: daysAgoIso(0, 1.2),
          active_page: 'pos',
          active_page_label: 'Mostrador (POS)',
          user_role: 'Vendedor',
          warehouse_name: 'Bodega Principal Mayorista',
          branch_name: 'Sede Principal',
          currency: 'USD',
          platform: 'Android · Chrome Móvil',
          online: true,
        },
        status: 'pendiente',
        assigned_to: null,
        assigned_name: null,
        tech_diagnosis: null,
        resolution_notes: null,
        resolved_at: null,
        created_at: daysAgoIso(0, 1.2),
        updated_at: daysAgoIso(0, 1.2),
      },
      {
        id: 'sup-tk-2',
        ticket_number: 'SOP-1041',
        company_id: DEMO_COMPANY_ID,
        company_name: 'Distribuidora Los Andes C.A.',
        user_id: 'demo-almacen-1',
        user_name: 'Marco Paredes',
        user_email: 'almacen@losandesdemo.com',
        user_role: 'almacen',
        category: 'inventario',
        priority: 'normal',
        subject: 'Revisión de diferencia en traslado hacia Sucursal Centro',
        description: 'Autorizo revisión de sesión para validar las unidades reservadas en el traslado TRF-001 antes de confirmar la recepción parcial.',
        module_page: 'warehouses',
        session_authorized: true,
        authorization_code: 'AUT-5190-IP',
        authorized_at: daysAgoIso(0, 4),
        authorized_until: new Date(Date.now() + 44 * 3600 * 1000).toISOString(),
        revoked_at: null,
        authorization_scope: 'lectura_diagnostico',
        session_snapshot: {
          captured_at: daysAgoIso(0, 4),
          active_page: 'warehouses',
          active_page_label: 'Sedes y multibodega',
          user_role: 'Jefe de almacén',
          warehouse_name: 'Bodega Principal Mayorista',
          branch_name: 'Sede Principal',
          currency: 'USD',
          platform: 'Windows · Edge Desktop',
          online: true,
        },
        status: 'en_revision',
        assigned_to: 'demo-tecnico-1',
        assigned_name: 'Ing. Gabriel Soto',
        tech_diagnosis: 'Se verificó reserva activa RESV-DEMO-1 por 4 unidades de Café Molido Gourmet vinculada a cotización vigente.',
        resolution_notes: 'Estamos validando la liberación automática al vencer la cotización o al convertirla en venta.',
        resolved_at: null,
        created_at: daysAgoIso(0, 4),
        updated_at: daysAgoIso(0, 2),
      },
      {
        id: 'sup-tk-3',
        ticket_number: 'SOP-1038',
        company_id: DEMO_COMPANY_ID,
        company_name: 'Distribuidora Los Andes C.A.',
        user_id: 'demo-contador-1',
        user_name: 'Elena Rivas',
        user_email: 'contabilidad@losandesdemo.com',
        user_role: 'contador',
        category: 'contabilidad',
        priority: 'normal',
        subject: 'Parametrización de cuenta puente para gastos de transporte',
        description: 'Solicitud de acompañamiento técnico para vincular la categoría Transporte y fletes con la cuenta 6101.',
        module_page: 'accsetup',
        session_authorized: false,
        authorization_code: 'AUT-3014-IP',
        authorized_at: daysAgoIso(2, 3),
        authorized_until: daysAgoIso(1, 3),
        revoked_at: null,
        authorization_scope: 'lectura_diagnostico',
        session_snapshot: {
          captured_at: daysAgoIso(2, 3),
          active_page: 'accsetup',
          active_page_label: 'Config. contable',
          user_role: 'Contador público',
          warehouse_name: 'Bodega Principal Mayorista',
          branch_name: 'Sede Principal',
          currency: 'USD',
          platform: 'Windows · Chrome Desktop',
          online: true,
        },
        status: 'resuelto',
        assigned_to: 'demo-tecnico-1',
        assigned_name: 'Ing. Gabriel Soto',
        tech_diagnosis: 'Mapeo contable verificado en acc_settings sin asientos descuadrados.',
        resolution_notes: 'Quedó enlazada la cuenta 6101 Gastos Operativos y Servicios y conciliado el período actual.',
        resolved_at: daysAgoIso(2, 1),
        created_at: daysAgoIso(2, 3),
        updated_at: daysAgoIso(2, 1),
      },
      {
        id: 'sup-tk-4',
        ticket_number: 'SOP-1043',
        company_id: 'co-client-101',
        company_name: 'Supermercados El Trébol S.A.',
        user_id: 'client-user-101',
        user_name: 'Roberto Mendoza',
        user_email: 'gerencia@eltrebol.com',
        user_role: 'dueno',
        category: 'ventas_pos',
        priority: 'alta',
        subject: 'Revisión de cierre fiscal diario y desglose de cobranzas',
        description: 'Autorizo inspección temporal en el módulo de ventas para verificar el resumen por forma de pago del turno vespertino.',
        module_page: 'sales',
        session_authorized: true,
        authorization_code: 'AUT-9104-IP',
        authorized_at: daysAgoIso(0, 0.6),
        authorized_until: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        revoked_at: null,
        authorization_scope: 'intervencion_asistida',
        session_snapshot: {
          captured_at: daysAgoIso(0, 0.6),
          active_page: 'sales',
          active_page_label: 'Ventas',
          user_role: 'Dueño',
          warehouse_name: 'Sede Principal El Trébol',
          branch_name: 'Casa Matriz',
          currency: 'USD',
          platform: 'Windows · Chrome Desktop',
          online: true,
        },
        status: 'pendiente',
        assigned_to: null,
        assigned_name: null,
        tech_diagnosis: null,
        resolution_notes: null,
        resolved_at: null,
        created_at: daysAgoIso(0, 0.6),
        updated_at: daysAgoIso(0, 0.6),
      },
    ],
    cpa_working_papers: [
      {
        id: 'cpa-wp-1',
        company_id: DEMO_COMPANY_ID,
        period_ym: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
        checklist: {
          arqueos_caja: true,
          bancos_conciliados: true,
          kardex_inventario: true,
          cartera_cxp: true,
          iva_auxiliares: false,
          ajustes_depreciacion: false,
          mayor_cuadrado: true,
          estados_emitidos: false,
        },
        audit_notes: 'Partida doble cuadrada al céntimo. Pendiente únicamente cierre definitivo de auxiliares fiscales de fin de mes.',
        cpa_profile: {
          full_name: 'Lcda. Elena Rivas',
          license_number: 'CPC-48.921',
          firm_name: 'Rivas & Asociados · Contadores Públicos',
          title_label: 'Contadora Pública Colegiada',
          phone: '+58 414-7023310',
          email: 'contabilidad@losandesdemo.com',
        },
        updated_at: daysAgoIso(0, 3),
      },
    ],
    catalog_orders: [
      {
        id: 'cord-demo-3',
        company_id: DEMO_COMPANY_ID,
        order_number: 'WEB-1003',
        tracking_pin: '8820',
        customer_id: null,
        customer_type: 'juridica',
        customer_name: 'Inversiones Gastronómicas El Ávila C.A.',
        customer_document: 'J-41299018-4',
        contact_person: 'Lic. Mariana Urdaneta (Compras)',
        requires_invoice: true,
        customer_phone: '+58 414-9018820',
        customer_email: 'compras@elavilagastro.com',
        delivery_mode: 'delivery',
        delivery_address: 'Av. Francisco de Miranda, Torre Parque Cristal, PB Local 4',
        notes: 'Entregar antes de las 3:00 PM por área de recepción de mercancía.',
        items: [
          {
            product_id: 'prod-1',
            product_name: 'Café Molido Gourmet 500g',
            sku: '75910001',
            variant_id: 'v-cafe-1kg',
            variant_label: '1 kg',
            stock_multiplier: 2,
            quantity: 4,
            unit_price: 12.4,
            subtotal: 49.6,
            unit: 'unidad',
            image_url: demoImgCafe,
          },
          {
            product_id: 'prod-3',
            product_name: 'Harina de Maíz Precocida 1kg',
            sku: '75910003',
            variant_id: 'v-har-20kg',
            variant_label: 'Bulto × 20 kg',
            stock_multiplier: 20,
            quantity: 1,
            unit_price: 24.4,
            subtotal: 24.4,
            unit: 'unidad',
            image_url: demoImgHarina,
          },
        ],
        currency: 'USD',
        fx_currency: 'VES',
        fx_rate: 42.5,
        subtotal: 74.0,
        tax_rate: 0,
        tax_amount: 0,
        total: 74.0,
        payment_method: 'pago_movil',
        payment_reference: '84920145',
        payment_sender_bank: 'Banco Mercantil (0105)',
        payment_amount_reported: 74.0,
        payment_proof_url: makeDemoReceiptSvg({
          platform: 'Pago Móvil Interbancario · Banesco',
          reference: '84920145',
          amountText: 'Bs. 3.145,00 ($74.00)',
          sender: 'Inv. Gastronómicas El Ávila · J-41299018-4',
          receiver: 'Distribuidora Los Andes C.A. · 0412-5550140',
          dateText: 'Hoy · 10:42 AM',
          accentHex: '#047857',
        }),
        payment_status: 'pendiente_verificacion',
        order_status: 'nuevo',
        verified_by: null,
        verified_by_name: null,
        verified_at: null,
        admin_notes: null,
        sale_id: null,
        quotation_id: null,
        created_at: daysAgoIso(0, 0.3),
        updated_at: daysAgoIso(0, 0.3),
      },
      {
        id: 'cord-demo-2',
        company_id: DEMO_COMPANY_ID,
        order_number: 'WEB-1002',
        tracking_pin: '4519',
        customer_id: null,
        customer_type: 'natural',
        customer_name: 'Camila Restrepo',
        customer_document: 'CC-1032489120',
        contact_person: null,
        requires_invoice: false,
        customer_phone: '+57 300 812 4519',
        customer_email: 'camila.restrepo@correo.co',
        delivery_mode: 'pickup',
        delivery_address: 'Retiro en sede',
        notes: 'Paso a retirar el pedido a las 4:30 PM.',
        items: [
          {
            product_id: 'prod-5',
            product_name: 'Queso Blanco Pasteurizado 1kg',
            sku: '75910005',
            variant_id: 'v-queso-500g',
            variant_label: '500 g',
            stock_multiplier: 0.5,
            quantity: 2,
            unit_price: 4.1,
            subtotal: 8.2,
            unit: 'kg',
            image_url: demoImgQueso,
          },
          {
            product_id: 'prod-2',
            product_name: 'Aceite Vegetal Puro 1L',
            sku: '75910002',
            variant_id: 'v-aceite-5l',
            variant_label: 'Bidón 5 Litros',
            stock_multiplier: 5,
            quantity: 1,
            unit_price: 15.4,
            subtotal: 15.4,
            unit: 'litro',
            image_url: demoImgAceite,
          },
        ],
        currency: 'USD',
        fx_currency: 'COP',
        fx_rate: 4180,
        subtotal: 23.6,
        tax_rate: 0,
        tax_amount: 0,
        total: 23.6,
        payment_method: 'nequi',
        payment_reference: 'M9204182',
        payment_sender_bank: 'Nequi',
        payment_amount_reported: 23.6,
        payment_proof_url: makeDemoReceiptSvg({
          platform: 'Nequi · Comprobante de Envío',
          reference: 'M9204182',
          amountText: 'COP $98.648 ($23.60)',
          sender: 'Camila Restrepo · 300 812 4519',
          receiver: 'Distribuidora Los Andes · 300 412 8900',
          dateText: 'Hoy · 09:18 AM',
          accentHex: '#6d28d9',
        }),
        payment_status: 'pendiente_verificacion',
        order_status: 'nuevo',
        verified_by: null,
        verified_by_name: null,
        verified_at: null,
        admin_notes: null,
        sale_id: null,
        quotation_id: null,
        created_at: daysAgoIso(0, 1.4),
        updated_at: daysAgoIso(0, 1.4),
      },
      {
        id: 'cord-demo-1',
        company_id: DEMO_COMPANY_ID,
        order_number: 'WEB-1001',
        tracking_pin: '1234',
        customer_id: 'cust-3',
        customer_type: 'juridica',
        customer_name: 'Panadería San José',
        customer_document: 'J-41209876-3',
        contact_person: 'Sr. José Gregorio Rivas',
        requires_invoice: true,
        customer_phone: '0412-8901234',
        customer_email: 'admin@panaderiasanjose.com',
        delivery_mode: 'delivery',
        delivery_address: 'Av. Bolívar, Local 4',
        notes: 'Pedido semanal corroborado.',
        items: [
          {
            product_id: 'prod-3',
            product_name: 'Harina de Maíz Precocida 1kg',
            sku: '75910003',
            variant_id: 'v-har-1kg',
            variant_label: 'Unidad 1 kg',
            stock_multiplier: 1,
            quantity: 30,
            unit_price: 1.25,
            subtotal: 37.5,
            unit: 'unidad',
            image_url: demoImgHarina,
          },
          {
            product_id: 'prod-5',
            product_name: 'Queso Blanco Pasteurizado 1kg',
            sku: '75910005',
            variant_id: 'v-queso-1kg',
            variant_label: '1 kg',
            stock_multiplier: 1,
            quantity: 5,
            unit_price: 7.1,
            subtotal: 35.5,
            unit: 'kg',
            image_url: demoImgQueso,
          },
        ],
        currency: 'USD',
        fx_currency: null,
        fx_rate: null,
        subtotal: 73.0,
        tax_rate: 0,
        tax_amount: 0,
        total: 73.0,
        payment_method: 'zelle',
        payment_reference: 'ZL-774109',
        payment_sender_bank: 'Zelle · Bank of America',
        payment_amount_reported: 73.0,
        payment_proof_url: makeDemoReceiptSvg({
          platform: 'Zelle Payment Confirmation',
          reference: 'ZL-774109',
          amountText: 'USD $73.00',
          sender: 'Panaderia San Jose LLC',
          receiver: 'pagos@losandesdemo.com',
          dateText: 'Hoy · 08:05 AM',
          accentHex: '#1d4ed8',
        }),
        payment_status: 'verificado',
        order_status: 'despachado',
        verified_by: 'demo-dueno-1',
        verified_by_name: 'Valentina Morales',
        verified_at: daysAgoIso(0, 1.5),
        admin_notes: 'Transferencia Zelle confirmada en cuenta y despachada con unidad Norte.',
        sale_id: 'sale-demo-2',
        quotation_id: null,
        created_at: daysAgoIso(0, 2.2),
        updated_at: daysAgoIso(0, 1.2),
      },
    ],
    demo_client_companies: [
      {
        company_id: 'co-client-101',
        company_name: 'Supermercados El Trébol S.A.',
        owner_name: 'Roberto Mendoza',
        owner_email: 'gerencia@eltrebol.com',
        members_count: 14,
        plan_type: 'empresarial',
        subscription_status: 'active',
        trial_start: null,
        trial_end: null,
        subscription_start: daysAgoIso(42),
        subscription_end: trialEndIso,
        created_at: daysAgoIso(45),
      },
      {
        company_id: 'co-client-102',
        company_name: 'Farmacia Salud Integral C.A.',
        owner_name: 'Dra. Patricia Gómez',
        owner_email: 'administracion@farmaciasalud.com',
        members_count: 6,
        plan_type: 'profesional',
        subscription_status: 'trial',
        trial_start: daysAgoIso(3),
        trial_end: new Date(Date.now() + 4 * 86400000).toISOString(),
        subscription_start: null,
        subscription_end: null,
        created_at: daysAgoIso(4),
      },
      {
        company_id: 'co-client-103',
        company_name: 'Repuestos y Motores Oriente S.R.L.',
        owner_name: 'Héctor Villalobos',
        owner_email: 'ventas@motoresoriente.com',
        members_count: 9,
        plan_type: 'emprendedor',
        subscription_status: 'expired',
        trial_start: daysAgoIso(18),
        trial_end: daysAgoIso(11),
        subscription_start: null,
        subscription_end: null,
        created_at: daysAgoIso(20),
      },
    ],
    platform_staff: [
      {
        user_id: 'demo-tecnico-1',
        staff_role: 'support_manager',
        active: true,
        permissions: {
          manage_plans: false,
          view_commercial_companies: true,
          support_inbox: true,
          sql_diagnostics: true,
          audit_logs: true,
        },
        notes: 'Líder técnico de soporte y sesiones autorizadas',
        granted_by: 'demo-owner-1',
        granted_at: daysAgoIso(30),
        updated_at: daysAgoIso(5),
      },
      {
        user_id: 'demo-admin-emp-1',
        staff_role: 'operations_manager',
        active: true,
        permissions: {
          manage_plans: true,
          view_commercial_companies: true,
          support_inbox: false,
          sql_diagnostics: false,
          audit_logs: true,
        },
        notes: 'Activación comercial y seguimiento de suscripciones',
        granted_by: 'demo-owner-1',
        granted_at: daysAgoIso(18),
        updated_at: daysAgoIso(2),
      },
    ],
    platform_admin_audit: [
      {
        id: 'paud-demo-1',
        actor_id: 'demo-owner-1',
        actor_email: 'sanlobo3@hotmail.com',
        target_company_id: 'co-client-101',
        target_user_id: null,
        target_email: null,
        event_type: 'company_plan_activated',
        event_data: {
          previous_plan: 'profesional',
          previous_status: 'trial',
          new_plan: 'empresarial',
          months: 3,
          subscription_end: trialEndIso,
          note: 'Comprobante bancario verificado #88412',
        },
        created_at: daysAgoIso(1, 2),
      },
      {
        id: 'paud-demo-2',
        actor_id: 'demo-owner-1',
        actor_email: 'sanlobo3@hotmail.com',
        target_company_id: 'co-client-102',
        target_user_id: null,
        target_email: null,
        event_type: 'company_trial_granted',
        event_data: {
          days: 7,
        },
        created_at: daysAgoIso(3, 1),
      },
      {
        id: 'paud-demo-3',
        actor_id: 'demo-owner-1',
        actor_email: 'sanlobo3@hotmail.com',
        target_company_id: null,
        target_user_id: 'demo-tecnico-1',
        target_email: 'soporte@inventariopro.demo',
        event_type: 'platform_staff_assigned',
        event_data: {
          previous_role: null,
          previous_active: null,
          new_role: 'support_manager',
          permissions: {
            manage_plans: false,
            view_commercial_companies: true,
            support_inbox: true,
            sql_diagnostics: true,
            audit_logs: true,
          },
        },
        created_at: daysAgoIso(5, 4),
      },
    ],
  }

  const getTable = (name: string): Row[] => {
    if (!tables[name]) tables[name] = []
    return tables[name]
  }

  const SESSION_KEY = 'ip_mock_auth_session'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let currentSession: any = null
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (raw) currentSession = JSON.parse(raw)
  } catch { /* ignore */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const authListeners = new Set<(event: string, session: any) => void>()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const saveSession = (s: any) => {
    currentSession = s
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
      else sessionStorage.removeItem(SESSION_KEY)
    } catch { /* ignore */ }
  }

  const ensureProfile = (email: string, fullName?: string) => {
    const cleanEmail = (email || 'demo@empresa.com').trim().toLowerCase()
    let profile = getTable('profiles').find(p => String(p.email).toLowerCase() === cleanEmail)
    if (!profile) {
      profile = {
        id: genId(),
        email: cleanEmail,
        full_name: fullName?.trim() || cleanEmail.split('@')[0] || 'Usuario Demo',
        role: 'dueno',
        company_id: DEMO_COMPANY_ID,
        active: true,
        created_at: nowIso(),
        trial_start: nowIso(),
        trial_end: trialEndIso,
        subscription_status: 'trial',
        subscription_end: null,
        paypal_order_id: null,
        plan_type: 'profesional',
      }
      getTable('profiles').push(profile)
    } else if (!profile.company_id || profile.company_id === 'co-demo-1') {
      profile.company_id = DEMO_COMPANY_ID
    }
    return profile
  }

  if (currentSession?.user?.email) {
    const p = ensureProfile(currentSession.user.email, currentSession.user.user_metadata?.full_name)
    currentSession.user.id = p.id
  }

  const DEMO_PRODUCT_IMAGES_KEY = 'ip_demo_product_images_v1'

  function readPersistedDemoImages(): Record<string, string | null> {
    try {
      const raw = localStorage.getItem(DEMO_PRODUCT_IMAGES_KEY)
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  function writePersistedDemoImage(productId: string, imageUrl: string | null) {
    try {
      const map = readPersistedDemoImages()
      map[productId] = imageUrl
      localStorage.setItem(DEMO_PRODUCT_IMAGES_KEY, JSON.stringify(map))
    } catch {
      /* ignore quota errors */
    }
  }

  // Rehidratar imágenes subidas previamente en modo demostración para que persistan al refrescar
  {
    const savedImgMap = readPersistedDemoImages()
    const prodRows = getTable('products')
    const piRows = getTable('product_images')
    for (const p of prodRows) {
      if (Object.prototype.hasOwnProperty.call(savedImgMap, p.id)) {
        p.image_url = savedImgMap[p.id] || null
      }
      if (p.image_url) {
        piRows.push({
          id: `pi-${p.id}`,
          company_id: DEMO_COMPANY_ID,
          product_id: p.id,
          image_url: p.image_url,
          mime_type: 'image/jpeg',
          created_at: nowIso(),
          updated_at: nowIso(),
        })
      }
    }
  }

  function syncDemoProductImageState(productId: string, imageUrl: string | null) {
    const clean = imageUrl && String(imageUrl).trim() ? String(imageUrl).trim() : null
    const prod = getTable('products').find(p => p.id === productId)
    if (prod) prod.image_url = clean
    const piRows = getTable('product_images')
    const idx = piRows.findIndex(r => r.product_id === productId)
    if (!clean) {
      if (idx >= 0) piRows.splice(idx, 1)
    } else if (idx >= 0) {
      piRows[idx] = { ...piRows[idx], image_url: clean, updated_at: nowIso() }
    } else {
      piRows.push({
        id: genId(),
        company_id: DEMO_COMPANY_ID,
        product_id: productId,
        image_url: clean,
        mime_type: 'image/jpeg',
        created_at: nowIso(),
        updated_at: nowIso(),
      })
    }
    writePersistedDemoImage(productId, clean)
  }

  function makeBuilder(tableName: string) {
    let op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
    let headOnly = false
    let wantCount = false
    let singleMode: 'none' | 'single' | 'maybeSingle' = 'none'
    let payload: Row | Row[] | null = null
    let upsertConflictCol = 'id'
    const filters: Array<(r: Row) => boolean> = []
    let orderCol: string | null = null
    let orderAsc = true
    let limitCount: number | null = null
    let rangeBounds: [number, number] | null = null

    const execute = () => {
      const rows = getTable(tableName)

      if (op === 'insert' || op === 'upsert') {
        const items = (Array.isArray(payload) ? payload : [payload || {}]).map(item => ({
          id: item.id || genId(),
          created_at: item.created_at || nowIso(),
          ...item,
        }))
        for (const item of items) {
          const conflictKey = op === 'upsert' && upsertConflictCol ? upsertConflictCol : 'id'
          const idx = rows.findIndex(r => r[conflictKey] !== undefined && r[conflictKey] === item[conflictKey])
          if (idx >= 0 && op === 'upsert') rows[idx] = { ...rows[idx], ...item, id: rows[idx].id || item.id }
          else if (idx < 0) rows.push(item)

          if (tableName === 'product_images' && item.product_id) {
            syncDemoProductImageState(String(item.product_id), item.image_url ? String(item.image_url) : null)
          } else if (tableName === 'products' && item.id && 'image_url' in item) {
            syncDemoProductImageState(String(item.id), item.image_url ? String(item.image_url) : null)
          }
        }
        const out = singleMode !== 'none' ? (items[0] ?? null) : items
        return { data: out, error: null, count: items.length }
      }

      const matched = rows.filter(r => filters.every(fn => fn(r)))

      if (op === 'update') {
        const updated: Row[] = []
        for (const r of matched) {
          Object.assign(r, payload || {})
          updated.push({ ...r })
          if (tableName === 'products' && r.id && payload && !Array.isArray(payload) && 'image_url' in payload) {
            syncDemoProductImageState(String(r.id), r.image_url ? String(r.image_url) : null)
          } else if (tableName === 'product_images' && r.product_id) {
            syncDemoProductImageState(String(r.product_id), r.image_url ? String(r.image_url) : null)
          }
        }
        const out = singleMode !== 'none' ? (updated[0] ?? null) : updated
        return { data: out, error: null, count: updated.length }
      }

      if (op === 'delete') {
        const toRemove = new Set(matched)
        tables[tableName] = rows.filter(r => !toRemove.has(r))
        if (tableName === 'product_images') {
          for (const r of matched) {
            if (r.product_id) syncDemoProductImageState(String(r.product_id), null)
          }
        }
        return { data: matched, error: null, count: matched.length }
      }

      let result = matched.map(r => ({ ...r }))
      if (orderCol) {
        const col = orderCol
        result.sort((a, b) => {
          const va = a[col] ?? ''
          const vb = b[col] ?? ''
          if (va < vb) return orderAsc ? -1 : 1
          if (va > vb) return orderAsc ? 1 : -1
          return 0
        })
      }
      const totalCount = result.length
      if (rangeBounds) result = result.slice(rangeBounds[0], rangeBounds[1] + 1)
      if (limitCount !== null) result = result.slice(0, limitCount)

      if (headOnly) {
        return { data: null, error: null, count: wantCount ? totalCount : null }
      }
      if (singleMode === 'single') {
        if (!result.length) return { data: null, error: { message: 'Row not found', code: 'PGRST116' }, count: 0 }
        return { data: result[0], error: null, count: 1 }
      }
      if (singleMode === 'maybeSingle') {
        return { data: result[0] ?? null, error: null, count: result.length ? 1 : 0 }
      }
      return { data: result, error: null, count: wantCount ? totalCount : null }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {
      select(_cols?: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) headOnly = true
        if (opts?.count) wantCount = true
        return builder
      },
      insert(values: Row | Row[]) { op = 'insert'; payload = values; return builder },
      update(values: Row) { op = 'update'; payload = values; return builder },
      upsert(values: Row | Row[], opts?: { onConflict?: string }) {
        op = 'upsert'
        payload = values
        upsertConflictCol = (opts?.onConflict || 'id').split(',')[0].trim() || 'id'
        return builder
      },
      delete() { op = 'delete'; return builder },
      eq(col: string, val: unknown) { filters.push(r => r[col] === val); return builder },
      neq(col: string, val: unknown) { filters.push(r => r[col] !== val); return builder },
      gt(col: string, val: number | string) { filters.push(r => r[col] > val); return builder },
      gte(col: string, val: number | string) { filters.push(r => r[col] >= val); return builder },
      lt(col: string, val: number | string) { filters.push(r => r[col] < val); return builder },
      lte(col: string, val: number | string) { filters.push(r => r[col] <= val); return builder },
      in(col: string, vals: unknown[]) { filters.push(r => Array.isArray(vals) && vals.includes(r[col])); return builder },
      is(col: string, val: unknown) { filters.push(r => r[col] === val); return builder },
      ilike(col: string, pat: string) {
        const re = new RegExp('^' + String(pat).replace(/%/g, '.*') + '$', 'i')
        filters.push(r => re.test(String(r[col] ?? '')))
        return builder
      },
      like(col: string, pat: string) {
        const re = new RegExp('^' + String(pat).replace(/%/g, '.*') + '$')
        filters.push(r => re.test(String(r[col] ?? '')))
        return builder
      },
      not(col: string, _opStr: string, val: unknown) { filters.push(r => r[col] !== val); return builder },
      or() { return builder },
      match(obj: Row) {
        for (const [k, v] of Object.entries(obj || {})) filters.push(r => r[k] === v)
        return builder
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col
        orderAsc = opts?.ascending !== false
        return builder
      },
      limit(n: number) { limitCount = n; return builder },
      range(from: number, to: number) { rangeBounds = [from, to]; return builder },
      single() { singleMode = 'single'; return builder },
      maybeSingle() { singleMode = 'maybeSingle'; return builder },
      then(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onFulfilled?: (v: any) => any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onRejected?: (e: any) => any
      ) {
        return Promise.resolve().then(execute).then(onFulfilled, onRejected)
      },
    }
    return builder
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleRpc = async (fn: string, args: Record<string, any> = {}): Promise<{ data: any; error: any }> => {
    const prods = getTable('products')
    const custs = getTable('customers')
    const sales = getTable('sales').filter(s => s.status !== 'anulada')

    switch (fn) {
      case 'register_device':
        return { data: { status: 'autorizado', enforced: false }, error: null }
      case 'dashboard_stats': {
        const monthStart = args.p_month_start ? new Date(args.p_month_start).getTime() : 0
        const lowStock = prods.filter(p => Number(p.stock) <= 0 || (Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock)))
        const stockCostVal = prods.reduce((acc, p) => acc + (Number(p.stock) || 0) * (Number(p.cost) || 0), 0)
        const stockRetailVal = prods.reduce((acc, p) => acc + (Number(p.stock) || 0) * (Number(p.price) || 0), 0)
        const revTotal = sales.reduce((acc, s) => acc + (Number(s.total) || 0), 0)
        const revMonth = sales
          .filter(s => new Date(s.created_at).getTime() >= monthStart)
          .reduce((acc, s) => acc + (Number(s.total) || 0), 0)
        return {
          data: {
            products_count: prods.length,
            customers_count: custs.length,
            sales_count: sales.length,
            revenue_total: revTotal,
            revenue_month: revMonth,
            low_stock_count: lowStock.length,
            stock_cost_value: Math.round(stockCostVal * 100) / 100,
            stock_retail_value: Math.round(stockRetailVal * 100) / 100,
            low_stock_items: lowStock.slice(0, 5).map(p => ({ name: p.name, stock: p.stock, min_stock: p.min_stock })),
          },
          error: null,
        }
      }
      case 'copilot_insights': {
        const low = prods.filter(p => Number(p.min_stock) > 0 && Number(p.stock) <= Number(p.min_stock))
        const alerts: Row[] = []
        if (low.length) {
          alerts.push({
            id: 'low-stock-demo',
            kind: 'stock',
            severity: low.some(p => Number(p.stock) <= 0) ? 'alta' : 'media',
            title: `${low.length} productos requieren reposición`,
            detail: low.map(p => `${p.name} (${p.stock}/${p.min_stock})`).join(', '),
            page: 'products',
            cta: 'Ver productos',
          })
        }
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const overdueSales = sales.filter(s => s.payment_method === 'fiado' && s.due_date && s.due_date < todayStr)
        if (overdueSales.length) {
          const sumOver = overdueSales.reduce((a, s) => a + (Number(s.total) || 0), 0)
          alerts.push({
            id: 'overdue-cartera-demo',
            kind: 'cartera',
            severity: 'alta',
            title: `Cartera vencida por cobrar ($${sumOver.toFixed(2)})`,
            detail: `${overdueSales[0].customer_name || 'Cliente'} tiene saldo vencido pendiente de cobro.`,
            page: 'cartera',
            cta: 'Cobrar en cartera',
          })
        }
        const expiringLots = getTable('product_lots').filter(l => Number(l.days_left) <= 15 && Number(l.qty_remaining) > 0)
        if (expiringLots.length) {
          alerts.push({
            id: 'lots-expiring-demo',
            kind: 'lotes',
            severity: 'media',
            title: `Lote próximo a vencer (${expiringLots[0].product_name})`,
            detail: `Lote ${expiringLots[0].lot_code} vence en ${expiringLots[0].days_left} días (${expiringLots[0].qty_remaining} uds).`,
            page: 'lots',
            cta: 'Revisar lotes',
          })
        }
        return { data: { alerts, generated_at: nowIso() }, error: null }
      }
      case 'ajustar_stock': {
        const p = prods.find(x => x.id === args.p_product_id)
        if (p) {
          const prev = Number(p.stock) || 0
          const next = Number(args.p_new_stock) || 0
          p.stock = next
          getTable('kardex').unshift({
            id: genId(),
            product_id: p.id,
            product_name: p.name,
            type: next >= prev ? 'entrada' : 'salida',
            quantity: Math.abs(next - prev),
            balance: next,
            reference_type: args.p_reason || 'ajuste',
            reference_id: null,
            created_at: nowIso(),
          })
        }
        return { data: { ok: true }, error: null }
      }
      case 'registrar_venta': {
        const items: Row[] = Array.isArray(args.p_items) ? args.p_items : []
        const sub = items.reduce((s, i) => s + (Number(i.subtotal) || Number(i.price) * Number(i.quantity) || 0), 0)
        const discount = Number(args.p_discount) || 0
        const total = Math.max(0, sub - discount)
        const cust = custs.find(c => c.id === args.p_customer_id)
        const saleId = args.p_client_id || genId()
        const newSale: Row = {
          id: saleId,
          customer_id: args.p_customer_id || null,
          customer_name: cust?.name || null,
          items,
          total,
          payment_method: args.p_payment_method || 'efectivo',
          status: args.p_payment_method === 'fiado' ? 'pendiente' : 'completada',
          channel: args.p_channel || 'ruta',
          discount_amount: discount || null,
          amount_received: args.p_received ?? null,
          fx_currency: args.p_fx_currency ?? null,
          fx_amount: args.p_fx_amount ?? null,
          fx_rate: args.p_fx_rate ?? null,
          created_at: args.p_captured_at || nowIso(),
        }
        getTable('sales').unshift(newSale)
        for (const it of items) {
          const prod = prods.find(p => p.id === it.product_id)
          if (prod) {
            prod.stock = Math.max(0, (Number(prod.stock) || 0) - (Number(it.quantity) || 0))
            getTable('kardex').unshift({
              id: genId(),
              product_id: prod.id,
              product_name: prod.name,
              type: 'salida',
              quantity: Number(it.quantity) || 0,
              balance: prod.stock,
              reference_type: 'venta',
              reference_id: saleId,
              created_at: nowIso(),
            })
          }
        }
        if (newSale.payment_method !== 'fiado') {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount: total,
            description: `Venta ${String(saleId).slice(0, 8).toUpperCase()}`,
            reference_type: 'sale',
            reference_id: saleId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: { id: saleId, ok: true }, error: null }
      }
      case 'purchase_suggestions': {
        const cover = Number(args.p_cover_days) || 15
        const items = prods
          .filter(p => Number(p.stock) <= Number(p.min_stock))
          .map(p => {
            const qty = Math.max(1, (Number(p.min_stock) || 5) * 2 - (Number(p.stock) || 0))
            const cost = Number(p.cost) || 0
            return {
              product_id: p.id,
              name: p.name,
              sku: p.sku || null,
              stock: Number(p.stock) || 0,
              min_stock: Number(p.min_stock) || 0,
              rate_day: 0.5,
              days_left: Number(p.stock) > 0 ? Math.round(Number(p.stock) / 0.5) : 0,
              qty,
              unit_cost: cost,
              line_total: qty * cost,
              supplier_id: 'sup-1',
              supplier_name: 'Distribuidora Nacional C.A.',
              severity: Number(p.stock) <= 0 ? 'alta' : 'media',
            }
          })
        return {
          data: {
            generated_at: nowIso(),
            cover_days: cover,
            total: items.reduce((s, i) => s + i.line_total, 0),
            items,
          },
          error: null,
        }
      }
      case 'copilot_query': {
        const kind = String(args.p_kind || '')
        const period = String(args.p_period || 'hoy')
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const filteredSales = period === 'hoy'
          ? sales.filter(s => String(s.created_at || '').slice(0, 10) === todayStr)
          : sales
        const rev = Math.round(filteredSales.reduce((s, x) => s + (Number(x.total) || 0), 0) * 100) / 100
        if (kind === 'ventas') {
          const byMethod: Record<string, number> = {}
          for (const s of filteredSales) {
            const m = s.payment_method || 'efectivo'
            byMethod[m] = Math.round(((byMethod[m] || 0) + Number(s.total || 0)) * 100) / 100
          }
          return {
            data: {
              kind: 'ventas',
              label: period === 'hoy' ? 'hoy' : `este ${period}`,
              count: filteredSales.length,
              total: rev,
              avg: filteredSales.length ? Math.round((rev / filteredSales.length) * 100) / 100 : 0,
              by_method: byMethod,
              mine: false,
            },
            error: null,
          }
        }
        if (kind === 'top_productos') {
          const map = new Map<string, { name: string; qty: number; revenue: number }>()
          for (const s of sales) {
            for (const it of (s.items || [])) {
              const cur = map.get(it.product_id) || { name: it.product_name || 'Producto', qty: 0, revenue: 0 }
              cur.qty += Number(it.quantity) || 0
              cur.revenue = Math.round((cur.revenue + (Number(it.subtotal) || 0)) * 100) / 100
              map.set(it.product_id, cur)
            }
          }
          const items = [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)
          return { data: { kind: 'top_productos', label: 'este mes', items }, error: null }
        }
        if (kind === 'top_clientes') {
          const map = new Map<string, { name: string; count: number; total: number }>()
          for (const s of sales) {
            const k = s.customer_id || s.customer_name || 'Mostrador'
            const cur = map.get(k) || { name: s.customer_name || 'Consumidor final', count: 0, total: 0 }
            cur.count += 1
            cur.total = Math.round((cur.total + Number(s.total || 0)) * 100) / 100
            map.set(k, cur)
          }
          const items = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5)
          return { data: { kind: 'top_clientes', label: 'este mes', items }, error: null }
        }
        if (kind === 'utilidad') {
          const totalRev = Math.round(sales.reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
          const totalCost = Math.round(totalRev * 0.66 * 100) / 100
          const profit = Math.round((totalRev - totalCost) * 100) / 100
          return {
            data: {
              kind: 'utilidad',
              label: 'este mes',
              revenue: totalRev,
              cost: totalCost,
              profit,
              margin: totalRev > 0 ? Math.round((profit / totalRev) * 1000) / 10 : 0,
            },
            error: null,
          }
        }
        if (kind === 'stock_resumen') {
          const sin = prods.filter(p => Number(p.stock) <= 0)
          const bajo = prods.filter(p => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock))
          return {
            data: {
              kind: 'stock_resumen',
              counts: { sin_stock: sin.length, bajo_minimo: bajo.length },
              items: [...sin, ...bajo],
            },
            error: null,
          }
        }
        if (kind === 'stock_producto') {
          const q = String(args.p_arg || '').toLowerCase()
          const matches = prods.filter(p => String(p.name).toLowerCase().includes(q) || String(p.sku || '').includes(q))
          return { data: { kind: 'stock_producto', arg: args.p_arg || '', items: matches }, error: null }
        }
        if (kind === 'deuda_total') {
          const fiados = sales.filter(s => s.payment_method === 'fiado')
          const owed = Math.round(fiados.reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
          const overdue = Math.round(fiados.filter(s => s.due_date && s.due_date < todayStr).reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
          return {
            data: {
              kind: 'deuda_total',
              owed,
              overdue,
              items: fiados.map(s => ({
                customer_id: s.customer_id,
                name: s.customer_name || 'Cliente',
                owed: Number(s.total),
                overdue: s.due_date && s.due_date < todayStr ? Number(s.total) : 0,
              })),
            },
            error: null,
          }
        }
        if (kind === 'deuda_cliente') {
          const q = String(args.p_arg || '').toLowerCase()
          const custMatches = getTable('customers').filter(c => String(c.name || '').toLowerCase().includes(q))
          const fiados = sales.filter(s => s.payment_method === 'fiado')
          const items = custMatches.map(c => {
            const cFiados = fiados.filter(s => s.customer_id === c.id)
            const owed = Math.round(cFiados.reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
            const overdue = Math.round(cFiados.filter(s => s.due_date && s.due_date < todayStr).reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
            return { customer_id: c.id, name: c.name, owed, overdue }
          })
          return { data: { kind: 'deuda_cliente', arg: args.p_arg || '', items }, error: null }
        }
        return { data: { kind, label: 'este periodo', count: 0, items: [], arg: args.p_arg || '' }, error: null }
      }
      case 'ai_config':
        return {
          data: {
            allowed: true,
            ai_enabled: false,
            plan: 'profesional',
            ai_daily_limit: 20,
            ai_used_today: 0,
            ai_remaining_today: 20,
            is_owner: true,
            brain_enabled: true,
            consent_ok: false,
            consent_tier: null,
            consent_at: null,
            month_cost: 0,
            month_cap: 5,
          },
          error: null,
        }
      case 'admin_list_users':
        return { data: getTable('profiles'), error: null }
      case 'monthly_sales': {
        const count = Number(args.p_months) || 6
        const now = new Date()
        const out: { month: string; total: number }[] = []
        const demoWeights = [840, 1120, 980, 1340, 1510, 1680, 1290, 1420, 1590, 1750, 1890]
        for (let i = count - 1; i >= 0; i--) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1)
          const ym = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
          if (i === 0) {
            const curTotal = sales
              .filter(s => String(s.created_at || '').startsWith(ym))
              .reduce((acc, s) => acc + (Number(s.total) || 0), 0)
            out.push({ month: ym, total: Math.max(curTotal, 319.4) })
          } else {
            out.push({ month: ym, total: demoWeights[(count - i) % demoWeights.length] })
          }
        }
        return { data: out, error: null }
      }
      case 'metas_progreso': {
        return {
          data: [
            {
              r_seller_id: 'demo-seller-1',
              r_sales_total: 1245.5,
              r_sales_count: 18,
              r_clients: 11,
              r_sales_goal: 1500,
              r_visits_goal: 15,
            },
            {
              r_seller_id: 'demo-seller-2',
              r_sales_total: 980.0,
              r_sales_count: 14,
              r_clients: 9,
              r_sales_goal: 1200,
              r_visits_goal: 12,
            },
          ],
          error: null,
        }
      }
      case 'list_team':
      case 'listar_nomina_equipo': {
        const mpList = getTable('member_profiles')
        const out = getTable('profiles')
          .map(p => {
            const mp = mpList.find(m => m.user_id === p.id)
            return {
              id: p.id,
              email: p.email,
              full_name: p.full_name,
              role: p.role,
              active: p.active !== false,
              created_at: p.created_at,
              avatar_url: mp?.avatar_url ?? null,
              national_id: mp?.national_id ?? null,
              phone: mp?.phone ?? null,
              job_title: mp?.job_title ?? null,
              zone: mp?.zone ?? null,
              address: mp?.address ?? null,
              emergency_contact: mp?.emergency_contact ?? null,
              hire_date: mp?.hire_date ?? null,
              base_salary: Number(mp?.base_salary) || 0,
              commission_pct: Number(mp?.commission_pct) || 0,
              notes: mp?.notes ?? null,
              archived: Boolean(mp?.archived),
            }
          })
          .filter(x => !x.archived)
        return { data: out, error: null }
      }
      case 'guardar_ficha_miembro': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (!p) return { data: null, error: { message: 'Miembro no encontrado' } }
        if (args.p_full_name) p.full_name = String(args.p_full_name).trim()
        if (args.p_role) p.role = args.p_role
        if (typeof args.p_active === 'boolean') p.active = args.p_active
        const mpList = getTable('member_profiles')
        let mp = mpList.find(m => m.user_id === p.id)
        const nextFields = {
          user_id: p.id,
          company_id: p.company_id || 'co-demo-1',
          avatar_url: args.p_avatar_url ?? null,
          national_id: args.p_national_id ?? null,
          phone: args.p_phone ?? null,
          job_title: args.p_job_title ?? null,
          zone: args.p_zone ?? null,
          address: args.p_address ?? null,
          emergency_contact: args.p_emergency_contact ?? null,
          hire_date: args.p_hire_date ?? null,
          base_salary: Number(args.p_base_salary) || 0,
          commission_pct: Number(args.p_commission_pct) || 0,
          notes: args.p_notes ?? null,
          archived: false,
        }
        if (mp) Object.assign(mp, nextFields)
        else mpList.push(nextFields)
        return { data: { ok: true, user_id: p.id }, error: null }
      }
      case 'guardar_mi_perfil': {
        const uid = currentSession?.user?.id || 'demo-owner-1'
        const p = getTable('profiles').find(x => x.id === uid)
        if (p && args.p_full_name) p.full_name = String(args.p_full_name).trim()
        const mpList = getTable('member_profiles')
        const mp = mpList.find(m => m.user_id === uid)
        const patch = {
          user_id: uid,
          company_id: p?.company_id || 'co-demo-1',
          avatar_url: args.p_avatar_url ?? null,
          national_id: args.p_national_id ?? null,
          phone: args.p_phone ?? null,
          address: args.p_address ?? null,
          emergency_contact: args.p_emergency_contact ?? null,
        }
        if (mp) Object.assign(mp, patch)
        else mpList.push(patch)
        return { data: { ok: true }, error: null }
      }
      case 'retirar_miembro_empresa':
      case 'admin_eliminar_perfil': {
        const uid = args.p_user_id
        tables.profiles = getTable('profiles').filter(x => x.id !== uid)
        tables.member_profiles = getTable('member_profiles').filter(x => x.user_id !== uid)
        return { data: { ok: true, mode: 'eliminado', message: 'Perfil eliminado correctamente.' }, error: null }
      }
      case 'info_invitacion': {
        const code = String(args.p_code || '').trim().toLowerCase()
        const inv = getTable('company_invites').find(i => i.active && String(i.code).toLowerCase() === code)
        if (!inv) return { data: { valid: false }, error: null }
        const cfg = getTable('company_config')[0]
        return {
          data: {
            valid: true,
            code: inv.code,
            company_id: inv.company_id || 'co-demo-1',
            company_name: cfg?.name || 'Comercial Demo',
            expires_at: inv.expires_at,
          },
          error: null,
        }
      }
      case 'aceptar_invitacion_vendedor': {
        const code = String(args.p_code || '').trim().toLowerCase()
        const inv = getTable('company_invites').find(i => i.active && String(i.code).toLowerCase() === code)
        if (!inv) return { data: null, error: { message: 'La invitación no existe o venció' } }
        const uid = currentSession?.user?.id
        const p = getTable('profiles').find(x => x.id === uid)
        if (p) {
          p.role = 'vendedor'
          p.company_id = inv.company_id || 'co-demo-1'
          p.active = true
        }
        inv.used_count = (Number(inv.used_count) || 0) + 1
        return { data: { ok: true, already_member: false, company_id: inv.company_id || 'co-demo-1' }, error: null }
      }
      case 'crear_invitacion': {
        const code = 'VEN' + Math.floor(1000 + Math.random() * 9000)
        getTable('company_invites').unshift({
          id: genId(),
          company_id: 'co-demo-1',
          code,
          active: true,
          max_uses: Number(args.p_max_uses) || 5,
          used_count: 0,
          expires_at: new Date(Date.now() + (Number(args.p_days) || 7) * 86400000).toISOString(),
          created_at: nowIso(),
        })
        return { data: { success: true, code }, error: null }
      }
      case 'revocar_invitacion': {
        const inv = getTable('company_invites').find(x => x.id === args.p_id)
        if (inv) inv.active = false
        return { data: { ok: true }, error: null }
      }
      case 'vincular_vendedor_existente': {
        const email = String(args.p_email || '').trim().toLowerCase()
        let p = getTable('profiles').find(x => String(x.email).toLowerCase() === email)
        if (!p) {
          p = {
            id: genId(),
            email,
            full_name: email.split('@')[0],
            role: 'vendedor',
            company_id: 'co-demo-1',
            active: true,
            created_at: nowIso(),
            trial_start: nowIso(),
            trial_end: trialEndIso,
            subscription_status: 'active',
            subscription_end: trialEndIso,
            paypal_order_id: null,
            plan_type: 'profesional',
          }
          getTable('profiles').push(p)
        } else {
          p.role = 'vendedor'
          p.company_id = 'co-demo-1'
          p.active = true
        }
        return { data: { ok: true, user_id: p.id, message: `${p.full_name || p.email} quedó vinculado como Vendedor de tu empresa.` }, error: null }
      }
      case 'admin_listar_empresas': {
        const cfg = getTable('company_config')[0]
        const ownCompanyRow = {
          company_id: DEMO_COMPANY_ID,
          company_name: cfg?.name || 'Comercial Demo',
          owner_name: 'Administrador Demo',
          owner_email: 'admin@empresa.com',
          members_count: getTable('profiles').filter(p => (p.company_id || DEMO_COMPANY_ID) === DEMO_COMPANY_ID).length,
          plan_type: 'profesional',
          subscription_status: 'active',
          trial_start: daysAgoIso(90),
          trial_end: trialEndIso,
          subscription_start: daysAgoIso(90),
          subscription_end: trialEndIso,
          created_at: daysAgoIso(90),
        }
        return {
          data: [
            ownCompanyRow,
            ...getTable('demo_client_companies').map(c => ({ ...c })),
          ],
          error: null,
        }
      }
      case 'admin_listar_usuarios_completo': {
        const cfg = getTable('company_config')[0]
        const mpList = getTable('member_profiles')
        return {
          data: getTable('profiles').map(p => {
            const mp = mpList.find(m => m.user_id === p.id)
            return {
              ...p,
              company_id: p.company_id || 'co-demo-1',
              company_name: cfg?.name || 'Comercial Demo',
              avatar_url: mp?.avatar_url ?? null,
              national_id: mp?.national_id ?? null,
              phone: mp?.phone ?? null,
              job_title: mp?.job_title ?? null,
              zone: mp?.zone ?? null,
              address: mp?.address ?? null,
              emergency_contact: mp?.emergency_contact ?? null,
              hire_date: mp?.hire_date ?? null,
              base_salary: Number(mp?.base_salary) || 0,
              commission_pct: Number(mp?.commission_pct) || 0,
              notes: mp?.notes ?? null,
              archived: Boolean(mp?.archived),
            }
          }),
          error: null,
        }
      }
      case 'admin_guardar_usuario_completo': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (!p) return { data: null, error: { message: 'Usuario no encontrado' } }
        if (args.p_full_name) p.full_name = String(args.p_full_name).trim()
        if (args.p_role) p.role = args.p_role
        if (args.p_company_id) p.company_id = args.p_company_id
        if (typeof args.p_active === 'boolean') p.active = args.p_active
        const mpList = getTable('member_profiles')
        const mp = mpList.find(m => m.user_id === p.id)
        const patch = {
          user_id: p.id,
          company_id: p.company_id || 'co-demo-1',
          avatar_url: args.p_avatar_url ?? null,
          national_id: args.p_national_id ?? null,
          phone: args.p_phone ?? null,
          job_title: args.p_job_title ?? null,
          zone: args.p_zone ?? null,
          address: args.p_address ?? null,
          emergency_contact: args.p_emergency_contact ?? null,
          hire_date: args.p_hire_date ?? null,
          base_salary: Number(args.p_base_salary) || 0,
          commission_pct: Number(args.p_commission_pct) || 0,
          notes: args.p_notes ?? null,
          archived: false,
        }
        if (mp) Object.assign(mp, patch)
        else mpList.push(patch)
        return { data: { ok: true, user_id: p.id }, error: null }
      }
      case 'admin_set_role': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (p && args.p_role) p.role = args.p_role
        return { data: null, error: null }
      }
      case 'admin_set_active': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (p && typeof args.p_active === 'boolean') p.active = args.p_active
        return { data: null, error: null }
      }
      case 'admin_activate_subscription': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (p) {
          p.subscription_status = 'active'
          p.plan_type = args.p_plan || 'profesional'
          p.subscription_end = new Date(Date.now() + (Number(args.p_months) || 1) * 30 * 86400000).toISOString()
        }
        return { data: null, error: null }
      }
      case 'admin_deactivate_subscription': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (p) p.subscription_status = 'expired'
        return { data: null, error: null }
      }
      case 'admin_reset_trial': {
        const p = getTable('profiles').find(x => x.id === args.p_user_id)
        if (p) {
          p.subscription_status = 'trial'
          p.trial_end = new Date(Date.now() + (Number(args.p_days) || 7) * 86400000).toISOString()
        }
        return { data: null, error: null }
      }
      case 'device_usage': {
        const devs = getTable('devices').filter(d => d.status === 'autorizado')
        return { data: { plan: 'profesional', limit: 5, used: devs.length, enforced: false }, error: null }
      }
      case 'set_device_status': {
        const d = getTable('devices').find(x => x.id === args.p_id)
        if (d && args.p_status) d.status = args.p_status
        return { data: null, error: null }
      }
      case 'delete_device': {
        tables.devices = getTable('devices').filter(x => x.id !== args.p_id)
        return { data: null, error: null }
      }
      case 'set_device_enforcement':
        return { data: null, error: null }
      case 'cartera_clientes': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const devs = getTable('devolutions').filter(d => (d.refund_method || 'cartera') === 'cartera')
        const allocs = getTable('credit_allocations')
        const activePays = new Set(getTable('credit_payments').filter(p => p.status === 'activo').map(p => p.id))
        const fiadoSales = sales.filter(s => s.payment_method === 'fiado')
        const customersOut: Row[] = []
        let totalOwed = 0
        let totalOverdue = 0
        for (const c of custs) {
          const open = fiadoSales
            .filter(s => s.customer_id === c.id)
            .map((s): Row => {
              const paid = allocs.filter(a => a.sale_id === s.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
              const ret = devs.filter(d => d.sale_id === s.id).reduce((acc, d) => acc + Number(d.amount), 0)
              const balance = Math.round(Math.max(0, Number(s.total) - ret - paid) * 100) / 100
              return { ...s, balance }
            })
            .filter(s => s.balance > 0)
          if (!open.length) continue
          const owed = Math.round(open.reduce((acc, s) => acc + s.balance, 0) * 100) / 100
          const overdue = Math.round(open.filter(s => s.due_date && s.due_date < todayStr).reduce((acc, s) => acc + s.balance, 0) * 100) / 100
          const dueDates = open.map(s => s.due_date).filter(Boolean).sort()
          totalOwed += owed
          totalOverdue += overdue
          customersOut.push({
            customer_id: c.id,
            name: c.name,
            phone: c.phone || null,
            document: c.document || null,
            owed,
            overdue,
            oldest_due: dueDates[0] || null,
            open_sales: open.length,
            credit_limit: 500,
            credit_days: 15,
            last_payment: null,
          })
        }
        customersOut.sort((a, b) => (b.overdue - a.overdue) || (b.owed - a.owed))
        return {
          data: {
            today: todayStr,
            generated_at: nowIso(),
            total_owed: Math.round(totalOwed * 100) / 100,
            total_overdue: Math.round(totalOverdue * 100) / 100,
            customers: customersOut,
          },
          error: null,
        }
      }
      case 'cxp_config': {
        const st = getTable('cxp_settings')[0]
        const acc = st?.account_id ? getTable('acc_accounts').find(a => a.id === st.account_id) : null
        const active = Boolean(getTable('acc_settings')[0]?.active)
        return {
          data: {
            account_id: st?.account_id ?? null,
            account_code: acc?.code ?? null,
            account_name: acc?.name ?? null,
            accounting_active: active,
          },
          error: null,
        }
      }
      case 'cxp_save_account': {
        const rows = getTable('cxp_settings')
        const accId = args.p_account ?? args.p_account_id ?? null
        if (rows.length) rows[0].account_id = accId
        else rows.push({ id: 'cxp-1', account_id: accId })
        return { data: {}, error: null }
      }
      case 'set_product_expiry': {
        const prod = prods.find(p => p.id === args.p_product)
        if (!prod) return { data: null, error: { message: 'Producto no encontrado' } }
        prod.tracks_expiry = Boolean(args.p_on)
        return { data: null, error: null }
      }
      case 'registrar_compra': {
        const items: Row[] = Array.isArray(args.p_items) ? args.p_items : []
        if (!items.length) return { data: null, error: { message: 'La compra debe tener al menos un producto' } }
        const method = String(args.p_payment_method || 'efectivo')
        if (!['efectivo', 'tarjeta', 'transferencia', 'credito'].includes(method)) {
          return { data: null, error: { message: 'Forma de pago de compra inválida' } }
        }
        const sups = getTable('suppliers')
        const sup = sups.find(s => s.id === args.p_supplier_id)
        if (method === 'credito' && !sup) {
          return { data: null, error: { message: 'Selecciona un proveedor para comprar a crédito' } }
        }
        const normalized = items.map(it => {
          const prod = prods.find(p => p.id === it.product_id)
          const qty = Number(it.quantity) || 0
          const cost = Number(it.cost) || 0
          return {
            product_id: it.product_id,
            product_name: prod?.name || it.product_name || 'Producto',
            quantity: qty,
            cost,
            prev_cost: Number(prod?.cost) || 0,
            subtotal: Math.round(qty * cost * 100) / 100,
            ...(it.expiry_date ? { lot_code: it.lot_code || 'S/L', expiry_date: it.expiry_date } : {}),
          }
        })
        const total = Math.round(normalized.reduce((s, i) => s + i.subtotal, 0) * 100) / 100
        let days: number | null = null
        let dueDate: string | null = null
        if (method === 'credito' && sup) {
          const sc = getTable('supplier_credit').find(x => x.supplier_id === sup.id)
          days = args.p_credit_days != null ? Number(args.p_credit_days) : (sc?.credit_days ?? 30)
          if (sc && Number(sc.credit_limit) > 0) {
            const allocs = getTable('supplier_allocations')
            const activePays = new Set(getTable('supplier_payments').filter(p => p.status === 'activo').map(p => p.id))
            const curOwed = getTable('purchases')
              .filter(p => p.supplier_id === sup.id && p.payment_method === 'credito' && p.status !== 'anulada')
              .reduce((sum, p) => {
                const paid = allocs.filter(a => a.purchase_id === p.id && activePays.has(a.payment_id)).reduce((s, a) => s + Number(a.amount), 0)
                return sum + Math.max(0, Number(p.total) - paid)
              }, 0)
            if (curOwed + total > Number(sc.credit_limit)) {
              return { data: null, error: { message: 'Supera el cupo de crédito con este proveedor' } }
            }
          }
          const d = new Date()
          d.setDate(d.getDate() + (days || 0))
          dueDate = d.toLocaleDateString('sv-SE')
        }
        const purchaseId = genId()
        const newPurchase: Row = {
          id: purchaseId,
          supplier_id: sup?.id || null,
          supplier_name: sup?.name || null,
          items: normalized,
          total,
          status: 'recibida',
          payment_method: method,
          due_date: dueDate,
          credit_days: days,
          created_at: nowIso(),
        }
        getTable('purchases').unshift(newPurchase)
        for (const it of normalized) {
          const prod = prods.find(p => p.id === it.product_id)
          if (prod) {
            const oldStock = Number(prod.stock) || 0
            const oldCost = Number(prod.cost) || 0
            const newStock = oldStock + it.quantity
            prod.cost = oldStock > 0 && newStock > 0
              ? Math.round(((oldStock * oldCost) + (it.quantity * it.cost)) / newStock * 100) / 100
              : Math.round(it.cost * 100) / 100
            prod.stock = newStock
            getTable('kardex').unshift({
              id: genId(),
              product_id: prod.id,
              product_name: prod.name,
              type: 'entrada',
              quantity: it.quantity,
              balance: prod.stock,
              reference_type: 'compra',
              reference_id: purchaseId,
              created_at: nowIso(),
            })
          }
        }
        if (method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: total,
            description: `Compra CMP-${String(purchaseId).slice(0, 8).toUpperCase()}`,
            reference_type: 'purchase',
            reference_id: purchaseId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: purchaseId, error: null }
      }
      case 'anular_compra': {
        const p = getTable('purchases').find(x => x.id === args.p_purchase_id)
        if (!p) return { data: null, error: { message: 'La compra no existe' } }
        if (p.status === 'anulada') return { data: null, error: { message: 'La compra ya fue anulada' } }
        const hasDevs = getTable('purchase_devolutions').some(d => d.purchase_id === p.id && d.status === 'activa')
        if (hasDevs) {
          return { data: null, error: { message: 'No se puede anular: esta compra ya tiene devoluciones parciales a proveedor. Anula primero esas devoluciones en el módulo Devoluciones.' } }
        }
        const activePays = new Set(getTable('supplier_payments').filter(x => x.status === 'activo').map(x => x.id))
        const hasAllocs = getTable('supplier_allocations').some(a => a.purchase_id === p.id && activePays.has(a.payment_id))
        if (hasAllocs) {
          return { data: null, error: { message: 'Esta compra tiene pagos aplicados. Anula primero los pagos en Cuentas por pagar.' } }
        }
        for (const it of (p.items || [])) {
          const prod = prods.find(x => x.id === it.product_id)
          if (prod && (Number(prod.stock) || 0) < (Number(it.quantity) || 0)) {
            return { data: null, error: { message: `No hay suficiente stock de ${prod.name} para revertir esta compra` } }
          }
        }
        for (const it of (p.items || [])) {
          const prod = prods.find(x => x.id === it.product_id)
          if (prod) {
            const oldStock = Number(prod.stock) || 0
            const oldCost = Number(prod.cost) || 0
            const qty = Number(it.quantity) || 0
            const itemTotal = Number(it.subtotal) || qty * (Number(it.cost) || 0)
            const newStock = Math.max(0, oldStock - qty)
            if (newStock > 0) {
              const rev = Math.round(((oldStock * oldCost) - itemTotal) / newStock * 100) / 100
              if (rev > 0) prod.cost = rev
            } else if (it.prev_cost !== undefined && Number(it.prev_cost) >= 0) {
              prod.cost = Math.round(Number(it.prev_cost) * 100) / 100
            }
            prod.stock = newStock
            getTable('kardex').unshift({
              id: genId(),
              product_id: prod.id,
              product_name: prod.name,
              type: 'salida',
              quantity: qty,
              balance: prod.stock,
              reference_type: 'anulacion_compra',
              reference_id: p.id,
              created_at: nowIso(),
            })
          }
        }
        p.status = 'anulada'
        if ((p.payment_method || 'efectivo') === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount: Number(p.total) || 0,
            description: `Anulación CMP-${String(p.id).slice(0, 8).toUpperCase()}`,
            reference_type: 'anulacion_compra',
            reference_id: p.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'cuentas_por_pagar': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const sups = getTable('suppliers')
        const credits = getTable('supplier_credit')
        const allocs = getTable('supplier_allocations')
        const activePays = new Set(getTable('supplier_payments').filter(x => x.status === 'activo').map(x => x.id))
        const pDevs = getTable('purchase_devolutions').filter(d => d.status === 'activa' && d.refund_method === 'credito')
        const creditPurchases = getTable('purchases').filter(p => p.payment_method === 'credito' && p.status !== 'anulada')
        const suppliersOut: Row[] = []
        let totalOwed = 0
        let totalOverdue = 0
        for (const s of sups) {
          const open = creditPurchases
            .filter(p => p.supplier_id === s.id)
            .map((p): Row => {
              const paid = allocs.filter(a => a.purchase_id === p.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
              const credRet = pDevs.filter(d => d.purchase_id === p.id).reduce((acc, d) => acc + Number(d.amount), 0)
              const balance = Math.round(Math.max(0, Number(p.total) - credRet - paid) * 100) / 100
              return { ...p, balance }
            })
            .filter(p => p.balance > 0)
          const sc = credits.find(c => c.supplier_id === s.id)
          if (!open.length && !(Number(sc?.credit_limit) > 0)) continue
          const owed = Math.round(open.reduce((acc, p) => acc + p.balance, 0) * 100) / 100
          const overdue = Math.round(open.filter(p => p.due_date && p.due_date < todayStr).reduce((acc, p) => acc + p.balance, 0) * 100) / 100
          const dueDates = open.map(p => p.due_date).filter(Boolean).sort()
          const lastPay = getTable('supplier_payments').find(py => py.supplier_id === s.id && py.status === 'activo')
          totalOwed += owed
          totalOverdue += overdue
          suppliersOut.push({
            supplier_id: s.id,
            name: s.name,
            document: s.document || null,
            phone: s.phone || null,
            owed,
            overdue,
            oldest_due: dueDates[0] || null,
            open_purchases: open.length,
            credit_limit: Number(sc?.credit_limit) || 0,
            credit_days: sc?.credit_days ?? 30,
            last_payment: lastPay?.created_at || null,
          })
        }
        suppliersOut.sort((a, b) => (b.overdue - a.overdue) || (b.owed - a.owed))
        return {
          data: {
            today: todayStr,
            generated_at: nowIso(),
            total_owed: Math.round(totalOwed * 100) / 100,
            total_overdue: Math.round(totalOverdue * 100) / 100,
            suppliers: suppliersOut,
          },
          error: null,
        }
      }
      case 'cuenta_por_pagar_proveedor': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const sup = getTable('suppliers').find(s => s.id === args.p_supplier_id)
        if (!sup) return { data: null, error: { message: 'El proveedor no existe' } }
        const sc = getTable('supplier_credit').find(c => c.supplier_id === sup.id)
        const allocs = getTable('supplier_allocations')
        const allPays = getTable('supplier_payments').filter(x => x.supplier_id === sup.id)
        const activePays = new Set(allPays.filter(x => x.status === 'activo').map(x => x.id))
        const pDevs = getTable('purchase_devolutions').filter(d => d.status === 'activa' && d.refund_method === 'credito')
        const allCredit = getTable('purchases')
          .filter(p => p.supplier_id === sup.id && p.payment_method === 'credito' && p.status !== 'anulada')
          .map(p => {
            const paid = Math.round(allocs.filter(a => a.purchase_id === p.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0) * 100) / 100
            const credRet = Math.round(pDevs.filter(d => d.purchase_id === p.id).reduce((acc, d) => acc + Number(d.amount), 0) * 100) / 100
            const balance = Math.round(Math.max(0, Number(p.total) - credRet - paid) * 100) / 100
            const daysOver = p.due_date && p.due_date < todayStr
              ? Math.max(1, Math.floor((new Date(todayStr + 'T00:00:00').getTime() - new Date(p.due_date + 'T00:00:00').getTime()) / 86400000))
              : 0
            return {
              id: p.id,
              created_at: p.created_at,
              due_date: p.due_date || null,
              total: Number(p.total),
              balance,
              days_overdue: daysOver,
            }
          })
        const purchasesOut = allCredit.filter(p => p.balance > 0.004)
        const owed = Math.round(purchasesOut.reduce((acc, p) => acc + p.balance, 0) * 100) / 100
        const overdue = Math.round(purchasesOut.filter(p => p.days_overdue > 0).reduce((acc, p) => acc + p.balance, 0) * 100) / 100
        return {
          data: {
            supplier: {
              id: sup.id,
              name: sup.name,
              phone: sup.phone || null,
              document: sup.document || null,
            },
            owed,
            overdue,
            credit_limit: Number(sc?.credit_limit) || 0,
            credit_days: sc?.credit_days ?? 30,
            purchases: purchasesOut,
            payments: allPays.map(py => ({
              id: py.id,
              amount: Number(py.amount),
              method: py.method || py.payment_method || 'efectivo',
              note: py.note ?? py.notes ?? null,
              status: py.status,
              by: py.created_by_name || 'Administrador Demo',
              created_at: py.created_at,
            })),
          },
          error: null,
        }
      }
      case 'guardar_credito_proveedor': {
        const supId = args.p_supplier ?? args.p_supplier_id
        const rows = getTable('supplier_credit')
        const existing = rows.find(x => x.supplier_id === supId)
        if (existing) {
          existing.credit_limit = Number(args.p_limit) || 0
          existing.credit_days = args.p_days ?? 30
        } else {
          rows.push({ supplier_id: supId, credit_limit: Number(args.p_limit) || 0, credit_days: args.p_days ?? 30 })
        }
        return { data: null, error: null }
      }
      case 'registrar_pago_proveedor': {
        const sup = getTable('suppliers').find(s => s.id === args.p_supplier_id)
        if (!sup) return { data: null, error: { message: 'El proveedor no existe' } }
        const amt = Math.round((Number(args.p_amount) || 0) * 100) / 100
        if (!(amt > 0)) return { data: null, error: { message: 'El pago debe ser mayor a cero' } }
        const allocs = getTable('supplier_allocations')
        const activePays = new Set(getTable('supplier_payments').filter(x => x.status === 'activo').map(x => x.id))
        const pDevs = getTable('purchase_devolutions').filter(d => d.status === 'activa' && d.refund_method === 'credito')
        const openPurchases = getTable('purchases')
          .filter(p => p.supplier_id === sup.id && p.payment_method === 'credito' && p.status !== 'anulada')
          .map(p => {
            const paid = allocs.filter(a => a.purchase_id === p.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
            const credRet = pDevs.filter(d => d.purchase_id === p.id).reduce((acc, d) => acc + Number(d.amount), 0)
            return { purchase: p, balance: Math.round(Math.max(0, Number(p.total) - credRet - paid) * 100) / 100 }
          })
          .filter(x => x.balance > 0)
          .sort((a, b) => String(a.purchase.created_at || '').localeCompare(String(b.purchase.created_at || '')))
        const totalOwed = Math.round(openPurchases.reduce((acc, x) => acc + x.balance, 0) * 100) / 100
        if (amt > totalOwed + 0.005) return { data: null, error: { message: 'El pago supera la deuda actual del proveedor' } }
        const payId = args.p_client_id || genId()
        const method = args.p_method || 'efectivo'
        getTable('supplier_payments').unshift({
          id: payId,
          supplier_id: sup.id,
          amount: amt,
          method,
          note: args.p_note ?? args.p_notes ?? null,
          status: 'activo',
          created_by_name: 'Administrador Demo',
          created_at: args.p_captured_at || nowIso(),
        })
        let rem = amt
        for (const item of openPurchases) {
          if (rem <= 0) break
          const apply = Math.round(Math.min(rem, item.balance) * 100) / 100
          allocs.push({ id: genId(), payment_id: payId, purchase_id: item.purchase.id, amount: apply })
          rem = Math.round((rem - apply) * 100) / 100
        }
        if (method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: amt,
            description: `Pago a proveedor - ${sup.name}`,
            reference_type: 'pago_proveedor',
            reference_id: payId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: payId, error: null }
      }
      case 'anular_pago_proveedor': {
        const pay = getTable('supplier_payments').find(x => x.id === args.p_payment_id)
        if (!pay) return { data: null, error: { message: 'El pago no existe' } }
        if (pay.status === 'anulado') return { data: null, error: { message: 'El pago ya está anulado' } }
        tables.supplier_allocations = getTable('supplier_allocations').filter(a => a.payment_id !== pay.id)
        pay.status = 'anulado'
        if ((pay.method || pay.payment_method) === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount: Number(pay.amount) || 0,
            description: `Anulación pago a proveedor`,
            reference_type: 'anulacion_pago_proveedor',
            reference_id: pay.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'asegurar_categorias_gasto': {
        return { data: null, error: null }
      }
      case 'guardar_categoria_gasto': {
        const clean = String(args.p_name || '').trim()
        if (!clean) return { data: null, error: { message: 'Escribe el nombre de la categoría de gasto' } }
        const cats = getTable('expense_categories')
        if (args.p_id) {
          const ex = cats.find(c => c.id === args.p_id)
          if (!ex) return { data: null, error: { message: 'Categoría no encontrada' } }
          ex.name = clean
          ex.account_id = args.p_account_id ?? null
          ex.active = args.p_active !== false
          return { data: ex.id, error: null }
        }
        const dup = cats.find(c => String(c.name).toLowerCase() === clean.toLowerCase())
        if (dup) {
          dup.account_id = args.p_account_id ?? null
          dup.active = args.p_active !== false
          return { data: dup.id, error: null }
        }
        const id = genId()
        cats.push({ id, name: clean, account_id: args.p_account_id ?? null, active: args.p_active !== false, created_at: nowIso() })
        return { data: id, error: null }
      }
      case 'registrar_gasto': {
        const amt = Math.round((Number(args.p_amount) || 0) * 100) / 100
        if (!(amt > 0)) return { data: null, error: { message: 'El monto del gasto debe ser mayor a cero' } }
        const desc = String(args.p_description || '').trim()
        if (!desc) return { data: null, error: { message: 'Escribe el concepto o descripción del gasto' } }
        const cat = getTable('expense_categories').find(c => c.id === args.p_category_id && c.active)
        if (!cat) return { data: null, error: { message: 'Selecciona una categoría de gasto activa' } }
        const method = String(args.p_method || 'efectivo')
        const id = genId()
        const expDate = args.p_expense_date || new Date().toLocaleDateString('sv-SE')
        getTable('expenses').unshift({
          id,
          category_id: cat.id,
          category_name: cat.name,
          amount: amt,
          method,
          expense_date: expDate,
          description: desc,
          beneficiary: args.p_beneficiary ? String(args.p_beneficiary).trim() : null,
          reference: args.p_reference ? String(args.p_reference).trim() : null,
          status: 'activo',
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
        })
        if (method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: amt,
            description: `Gasto (${cat.name}) - ${desc}`,
            reference_type: 'gasto',
            reference_id: id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: id, error: null }
      }
      case 'anular_gasto': {
        const g = getTable('expenses').find(x => x.id === args.p_expense_id)
        if (!g) return { data: null, error: { message: 'El gasto no existe' } }
        if (g.status === 'anulado') return { data: null, error: { message: 'Este gasto ya fue anulado' } }
        g.status = 'anulado'
        if (g.method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount: Number(g.amount) || 0,
            description: `Anulación de gasto - ${g.description}`,
            reference_type: 'anulacion_gasto',
            reference_id: g.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'registrar_devolucion': {
        const qty = Number(args.p_quantity) || 0
        if (!(qty > 0)) return { data: null, error: { message: 'Cantidad inválida' } }
        const reason = String(args.p_reason || '').trim()
        if (!reason) return { data: null, error: { message: 'El motivo es obligatorio' } }
        const sale = getTable('sales').find(s => s.id === args.p_sale_id)
        if (!sale || sale.status === 'anulada') return { data: null, error: { message: 'Venta no disponible' } }
        const items: Row[] = Array.isArray(sale.items) ? sale.items : []
        const prodItems = items.filter(x => x.product_id === args.p_product_id)
        const sold = prodItems.reduce((acc, x) => acc + (Number(x.quantity) || 0), 0)
        const soldAmt = prodItems.reduce((acc, x) => acc + (Number(x.subtotal) || 0), 0)
        const allItemsAmt = items.reduce((acc, x) => acc + (Number(x.subtotal) || 0), 0)
        if (sold <= 0) return { data: null, error: { message: 'Ese producto no pertenece a la venta' } }
        const returned = getTable('devolutions')
          .filter(d => d.sale_id === sale.id && d.product_id === args.p_product_id)
          .reduce((acc, d) => acc + (Number(d.quantity) || 0), 0)
        if (qty > sold - returned) return { data: null, error: { message: `Solo quedan ${sold - returned} unidad(es) por devolver` } }
        const factor = allItemsAmt > 0 && Number(sale.total) >= 0 ? Number(sale.total) / allItemsAmt : 1
        const amount = Math.round((qty * soldAmt / sold) * factor * 100) / 100
        const refundMethod = sale.payment_method === 'fiado'
          ? 'cartera'
          : (args.p_refund_method || sale.payment_method || 'efectivo')
        const prod = prods.find(p => p.id === args.p_product_id)
        if (!prod) return { data: null, error: { message: 'El producto ya no existe' } }
        prod.stock = (Number(prod.stock) || 0) + qty
        const devId = genId()
        getTable('devolutions').unshift({
          id: devId,
          sale_id: sale.id,
          product_id: prod.id,
          product_name: prod.name,
          quantity: qty,
          amount,
          reason,
          refund_method: refundMethod,
          created_at: nowIso(),
        })
        getTable('kardex').unshift({
          id: genId(),
          product_id: prod.id,
          product_name: prod.name,
          type: 'entrada',
          quantity: qty,
          balance: prod.stock,
          reference_type: 'devolution',
          reference_id: devId,
          created_at: nowIso(),
        })
        if (refundMethod === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount,
            description: `Devolución - ${prod.name}`,
            reference_type: 'devolution',
            reference_id: devId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: devId, error: null }
      }
      case 'registrar_devolucion_compra': {
        const qty = Number(args.p_quantity) || 0
        if (!(qty > 0)) return { data: null, error: { message: 'Cantidad inválida' } }
        const reason = String(args.p_reason || '').trim()
        if (!reason) return { data: null, error: { message: 'El motivo de la devolución es obligatorio' } }
        const pur = getTable('purchases').find(p => p.id === args.p_purchase_id)
        if (!pur || pur.status === 'anulada') return { data: null, error: { message: 'Compra no disponible' } }
        const items: Row[] = Array.isArray(pur.items) ? pur.items : []
        const prodItems = items.filter(x => x.product_id === args.p_product_id)
        const bought = prodItems.reduce((acc, x) => acc + (Number(x.quantity) || 0), 0)
        const boughtAmt = prodItems.reduce((acc, x) => acc + (Number(x.subtotal) || (Number(x.quantity) * Number(x.cost)) || 0), 0)
        if (bought <= 0) return { data: null, error: { message: 'Ese producto no pertenece a la compra seleccionada' } }
        const returned = getTable('purchase_devolutions')
          .filter(d => d.purchase_id === pur.id && d.product_id === args.p_product_id && d.status === 'activa')
          .reduce((acc, d) => acc + (Number(d.quantity) || 0), 0)
        if (qty > bought - returned) return { data: null, error: { message: `Solo quedan ${bought - returned} unidad(es) disponibles para devolver` } }
        const unitCost = Math.round((boughtAmt / bought) * 100) / 100
        const amount = Math.round((qty * boughtAmt / bought) * 100) / 100
        const refund = String(args.p_refund_method || pur.payment_method || 'efectivo')
        if (refund === 'credito') {
          if (pur.payment_method !== 'credito') {
            return { data: null, error: { message: 'Solo puedes descontar de Cuentas por pagar cuando la compra original fue a crédito' } }
          }
          const allocs = getTable('supplier_allocations')
          const activePays = new Set(getTable('supplier_payments').filter(x => x.status === 'activo').map(x => x.id))
          const paid = allocs.filter(a => a.purchase_id === pur.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
          const credRet = getTable('purchase_devolutions')
            .filter(d => d.purchase_id === pur.id && d.status === 'activa' && d.refund_method === 'credito')
            .reduce((acc, d) => acc + Number(d.amount), 0)
          const bal = Math.max(0, Number(pur.total) - credRet - paid)
          if (amount > bal + 0.005) {
            return { data: null, error: { message: `La devolución supera el saldo pendiente de esta compra (${bal.toFixed(2)})` } }
          }
        }
        const prod = prods.find(p => p.id === args.p_product_id)
        if (!prod) return { data: null, error: { message: 'El producto ya no existe' } }
        if ((Number(prod.stock) || 0) < qty) {
          return { data: null, error: { message: `Stock actual insuficiente de "${prod.name}" (en inventario: ${prod.stock})` } }
        }
        const oldStock = Number(prod.stock) || 0
        const oldCost = Number(prod.cost) || 0
        const newStock = oldStock - qty
        if (newStock > 0) {
          const revCost = Math.round(((oldStock * oldCost) - amount) / newStock * 100) / 100
          if (revCost > 0) prod.cost = revCost
        }
        prod.stock = newStock
        const devId = genId()
        getTable('purchase_devolutions').unshift({
          id: devId,
          purchase_id: pur.id,
          supplier_id: pur.supplier_id || null,
          supplier_name: pur.supplier_name || null,
          product_id: prod.id,
          product_name: prod.name,
          quantity: qty,
          unit_cost: unitCost,
          amount,
          refund_method: refund,
          reason,
          status: 'activa',
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
        })
        getTable('kardex').unshift({
          id: genId(),
          product_id: prod.id,
          product_name: prod.name,
          type: 'salida',
          quantity: qty,
          balance: prod.stock,
          reference_type: 'purchase_devolution',
          reference_id: devId,
          created_at: nowIso(),
        })
        if (refund === 'efectivo' && amount > 0) {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount,
            description: `Devolución a proveedor - ${prod.name}`,
            reference_type: 'purchase_devolution',
            reference_id: devId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: devId, error: null }
      }
      case 'anular_devolucion_compra': {
        const d = getTable('purchase_devolutions').find(x => x.id === args.p_dev_id)
        if (!d) return { data: null, error: { message: 'La devolución a proveedor no existe' } }
        if (d.status === 'anulada') return { data: null, error: { message: 'Esta devolución ya fue anulada' } }
        const prod = prods.find(p => p.id === d.product_id)
        if (!prod) return { data: null, error: { message: 'El producto ya no existe' } }
        const oldStock = Number(prod.stock) || 0
        const oldCost = Number(prod.cost) || 0
        const qty = Number(d.quantity) || 0
        const amt = Number(d.amount) || 0
        const newStock = oldStock + qty
        prod.cost = oldStock > 0 && newStock > 0
          ? Math.round(((oldStock * oldCost) + amt) / newStock * 100) / 100
          : Math.round((Number(d.unit_cost) || 0) * 100) / 100
        prod.stock = newStock
        d.status = 'anulada'
        getTable('kardex').unshift({
          id: genId(),
          product_id: prod.id,
          product_name: prod.name,
          type: 'entrada',
          quantity: qty,
          balance: prod.stock,
          reference_type: 'purchase_devolution',
          reference_id: d.id,
          created_at: nowIso(),
        })
        if (d.refund_method === 'efectivo' && amt > 0) {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: amt,
            description: `Anulación devolución a proveedor - ${prod.name}`,
            reference_type: 'anulacion_devolucion_compra',
            reference_id: d.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'touch_device':
        return { data: true, error: null }
      case 'my_company_subscription': {
        const uid = currentSession?.user?.id
        const p = getTable('profiles').find(x => x.id === uid) || getTable('profiles')[0]
        const cfg = getTable('company_config')[0]
        return {
          data: {
            company_id: p?.company_id || DEMO_COMPANY_ID,
            company_name: cfg?.name || 'Comercial Demo',
            plan_type: p?.plan_type || 'profesional',
            subscription_status: p?.subscription_status || 'trial',
            trial_start: p?.trial_start || nowIso(),
            trial_end: p?.trial_end || trialEndIso,
            subscription_end: p?.subscription_end || trialEndIso,
            platform_admin: p?.role === 'admin',
            subscription_access: true,
            unlimited_devices: p?.role === 'admin',
          },
          error: null,
        }
      }
      case 'cartera_cliente': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const cust = custs.find(c => c.id === args.p_customer_id)
        if (!cust) return { data: null, error: { message: 'El cliente no existe' } }
        const cc = getTable('customer_credit').find(x => x.customer_id === cust.id)
        const devs = getTable('devolutions').filter(d => (d.refund_method || 'cartera') === 'cartera')
        const allocs = getTable('credit_allocations')
        const allPays = getTable('credit_payments').filter(x => x.customer_id === cust.id)
        const activePays = new Set(allPays.filter(x => x.status === 'activo').map(x => x.id))
        const openSales = sales
          .filter(s => s.customer_id === cust.id && s.payment_method === 'fiado')
          .map(s => {
            const paid = allocs.filter(a => a.sale_id === s.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
            const ret = devs.filter(d => d.sale_id === s.id).reduce((acc, d) => acc + Number(d.amount), 0)
            const balance = Math.round(Math.max(0, Number(s.total) - ret - paid) * 100) / 100
            const daysOver = s.due_date && s.due_date < todayStr
              ? Math.max(1, Math.floor((new Date(todayStr + 'T00:00:00').getTime() - new Date(s.due_date + 'T00:00:00').getTime()) / 86400000))
              : 0
            return {
              id: s.id,
              total: Number(s.total),
              balance,
              due_date: s.due_date || null,
              created_at: s.created_at,
              days_overdue: daysOver,
            }
          })
          .filter(s => s.balance > 0.004)
        const owed = Math.round(openSales.reduce((acc, s) => acc + s.balance, 0) * 100) / 100
        const overdue = Math.round(openSales.filter(s => s.days_overdue > 0).reduce((acc, s) => acc + s.balance, 0) * 100) / 100
        return {
          data: {
            customer: { id: cust.id, name: cust.name, phone: cust.phone || null, document: cust.document || null },
            owed,
            overdue,
            credit_limit: Number(cc?.credit_limit ?? 500),
            credit_days: Number(cc?.credit_days ?? 15),
            sales: openSales,
            payments: allPays.map(py => ({
              id: py.id,
              amount: Number(py.amount),
              method: py.method || 'efectivo',
              status: py.status || 'activo',
              note: py.note ?? null,
              by: py.created_by_name || 'Administrador Demo',
              created_at: py.created_at,
            })),
          },
          error: null,
        }
      }
      case 'registrar_abono': {
        const cust = custs.find(c => c.id === args.p_customer_id)
        if (!cust) return { data: null, error: { message: 'El cliente no existe' } }
        const amt = Math.round((Number(args.p_amount) || 0) * 100) / 100
        if (!(amt > 0)) return { data: null, error: { message: 'El abono debe ser mayor a cero' } }
        const devs = getTable('devolutions').filter(d => (d.refund_method || 'cartera') === 'cartera')
        const allocs = getTable('credit_allocations')
        const activePays = new Set(getTable('credit_payments').filter(p => p.status === 'activo').map(p => p.id))
        const openSales = sales
          .filter(s => s.customer_id === cust.id && s.payment_method === 'fiado')
          .map(s => {
            const paid = allocs.filter(a => a.sale_id === s.id && activePays.has(a.payment_id)).reduce((acc, a) => acc + Number(a.amount), 0)
            const ret = devs.filter(d => d.sale_id === s.id).reduce((acc, d) => acc + Number(d.amount), 0)
            return { sale: s, balance: Math.round(Math.max(0, Number(s.total) - ret - paid) * 100) / 100 }
          })
          .filter(x => x.balance > 0)
          .sort((a, b) => String(a.sale.created_at || '').localeCompare(String(b.sale.created_at || '')))
        const payId = args.p_client_id || genId()
        const method = String(args.p_method || 'efectivo')
        getTable('credit_payments').unshift({
          id: payId,
          customer_id: cust.id,
          amount: amt,
          method,
          note: args.p_note ?? null,
          status: 'activo',
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
        })
        let rem = amt
        for (const item of openSales) {
          if (rem <= 0) break
          const apply = Math.round(Math.min(rem, item.balance) * 100) / 100
          allocs.push({ id: genId(), payment_id: payId, sale_id: item.sale.id, amount: apply })
          rem = Math.round((rem - apply) * 100) / 100
        }
        if (method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'ingreso',
            amount: amt,
            description: `Abono cartera - ${cust.name}`,
            reference_type: 'abono',
            reference_id: payId,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: payId, error: null }
      }
      case 'anular_abono': {
        const pay = getTable('credit_payments').find(x => x.id === args.p_payment_id)
        if (!pay) return { data: null, error: { message: 'El abono no existe' } }
        tables.credit_allocations = getTable('credit_allocations').filter(a => a.payment_id !== pay.id)
        pay.status = 'anulado'
        if (pay.method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: Number(pay.amount) || 0,
            description: 'Anulación de abono de cartera',
            reference_type: 'anulacion_abono',
            reference_id: pay.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'guardar_credito_cliente': {
        const cid = args.p_customer ?? args.p_customer_id
        const rows = getTable('customer_credit')
        const ex = rows.find(x => x.customer_id === cid)
        if (ex) {
          ex.credit_limit = Number(args.p_limit) || 0
          ex.credit_days = Number(args.p_days ?? 30)
        } else {
          rows.push({ customer_id: cid, credit_limit: Number(args.p_limit) || 0, credit_days: Number(args.p_days ?? 30) })
        }
        return { data: null, error: null }
      }
      case 'cxc_config': {
        const st = getTable('cxc_settings')[0]
        const acc = st?.account_id ? getTable('acc_accounts').find(a => a.id === st.account_id) : null
        return {
          data: {
            account_id: st?.account_id ?? null,
            account_code: acc?.code ?? null,
            account_name: acc?.name ?? null,
            accounting_active: Boolean(getTable('acc_settings')[0]?.active),
          },
          error: null,
        }
      }
      case 'cxc_save_account': {
        const rows = getTable('cxc_settings')
        const accId = args.p_account ?? null
        if (rows.length) rows[0].account_id = accId
        else rows.push({ id: 'cxc-1', account_id: accId })
        return { data: {}, error: null }
      }
      case 'cerrar_caja': {
        const counted = Math.round((Number(args.p_counted) || 0) * 100) / 100
        const expected = Math.round((Number(args.p_expected_seen) || 0) * 100) / 100
        const difference = Math.round((counted - expected) * 100) / 100
        const closing = {
          id: genId(),
          expected,
          counted,
          difference,
          notes: args.p_notes ?? null,
          closed_by_name: 'Administrador Demo',
          closed_at: nowIso(),
        }
        getTable('cash_closings').unshift(closing)
        if (difference !== 0) {
          const entry = {
            id: genId(),
            type: difference > 0 ? 'ingreso' : 'egreso',
            amount: Math.abs(difference),
            description: difference > 0 ? 'Sobrante de arqueo de caja' : 'Faltante de arqueo de caja',
            reference_type: 'cash_closing',
            reference_id: closing.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: closing, error: null }
      }
      case 'anular_venta': {
        const s = getTable('sales').find(x => x.id === args.p_sale_id)
        if (!s) return { data: null, error: { message: 'La venta no existe' } }
        if (s.status === 'anulada') return { data: null, error: { message: 'La venta ya está anulada' } }
        s.status = 'anulada'
        for (const it of (s.items || [])) {
          const prod = prods.find(p => p.id === it.product_id)
          if (prod) {
            prod.stock = (Number(prod.stock) || 0) + (Number(it.quantity) || 0)
            getTable('kardex').unshift({
              id: genId(),
              product_id: prod.id,
              product_name: prod.name,
              type: 'entrada',
              quantity: Number(it.quantity) || 0,
              balance: prod.stock,
              reference_type: 'anulacion_venta',
              reference_id: s.id,
              created_at: nowIso(),
            })
          }
        }
        if (s.payment_method === 'efectivo') {
          const entry = {
            id: genId(),
            type: 'egreso',
            amount: Number(s.total) || 0,
            description: `Anulación venta ${String(s.id).slice(0, 8).toUpperCase()}`,
            reference_type: 'anulacion_venta',
            reference_id: s.id,
            created_at: nowIso(),
          }
          getTable('cash_entries').unshift(entry)
          getTable('cash_movements').unshift(entry)
        }
        return { data: null, error: null }
      }
      case 'actualizar_precios_masivo': {
        const catId = args.p_category_id || null
        const mode = String(args.p_mode || 'pct_up')
        const pct = Number(args.p_pct) || 0
        const applyWholesale = Boolean(args.p_apply_wholesale)
        let updated = 0
        for (const p of prods) {
          if (catId && p.category_id !== catId) continue
          const factor = mode === 'pct_down' ? Math.max(0, 1 - pct / 100) : 1 + pct / 100
          p.price = Math.round(Number(p.price) * factor * 100) / 100
          if (applyWholesale && Number(p.price_wholesale) > 0) {
            p.price_wholesale = Math.round(Number(p.price_wholesale) * factor * 100) / 100
          }
          updated++
        }
        return { data: { updated }, error: null }
      }
      case 'obtener_mi_empresa_catalogo': {
        const cfg = getTable('company_config')[0] || {}
        return {
          data: {
            company_id: cfg.company_id || DEMO_COMPANY_ID,
            name: cfg.name || 'Comercial Demo',
            catalog_enabled: cfg.catalog_enabled !== false,
            catalog_show_wholesale: cfg.catalog_show_wholesale !== false,
            catalog_show_stock: cfg.catalog_show_stock !== false,
            catalog_welcome: cfg.catalog_welcome ?? null,
          },
          error: null,
        }
      }
      case 'guardar_ajustes_catalogo': {
        const cfg = getTable('company_config')[0]
        if (cfg) {
          cfg.catalog_enabled = Boolean(args.p_enabled)
          cfg.catalog_show_wholesale = Boolean(args.p_show_wholesale)
          cfg.catalog_show_stock = Boolean(args.p_show_stock)
          cfg.catalog_welcome = args.p_welcome ?? null
        }
        return { data: { ok: true }, error: null }
      }
      case 'guardar_identidad_catalogo': {
        const cfg = getTable('company_config')[0]
        if (cfg) {
          cfg.catalog_enabled = args.p_enabled !== false
          cfg.catalog_show_wholesale = args.p_show_wholesale !== false
          cfg.catalog_show_stock = args.p_show_stock !== false
          cfg.catalog_welcome = args.p_welcome ?? null
          cfg.logo_url = args.p_logo_url ?? null
          cfg.brand_theme = String(args.p_brand_theme || 'emerald')
          if (Array.isArray(args.p_payment_methods)) {
            cfg.catalog_payment_methods = args.p_payment_methods
          }
          if (Array.isArray(args.p_delivery_modes) && args.p_delivery_modes.length > 0) {
            cfg.catalog_delivery_modes = args.p_delivery_modes
          }
          if (args.p_catalog_slug !== undefined) {
            const rawSlug = String(args.p_catalog_slug || '')
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '')
            cfg.catalog_slug = rawSlug || null
          }
          if (args.p_whatsapp_settings && typeof args.p_whatsapp_settings === 'object') {
            cfg.whatsapp_settings = args.p_whatsapp_settings
          }
        }
        return {
          data: {
            ok: true,
            company_id: cfg?.company_id || DEMO_COMPANY_ID,
            brand_theme: cfg?.brand_theme || 'emerald',
            catalog_slug: cfg?.catalog_slug || null,
            whatsapp_settings: cfg?.whatsapp_settings || {},
          },
          error: null,
        }
      }
      case 'obtener_catalogo_publico':
      case 'resolver_catalogo_publico': {
        const cfg = getTable('company_config')[0]
        const targetRaw = String(args.p_slug_or_id ?? args.p_company_id ?? '').trim().toLowerCase()
        const cfgSlug = String(cfg?.catalog_slug || '').trim().toLowerCase()
        const cfgId = String(cfg?.company_id || DEMO_COMPANY_ID).trim().toLowerCase()
        if (
          !cfg ||
          (targetRaw &&
            targetRaw !== cfgId &&
            targetRaw !== DEMO_COMPANY_ID.toLowerCase() &&
            targetRaw !== 'co-demo-1' &&
            (!cfgSlug || targetRaw !== cfgSlug))
        ) {
          return { data: { available: false, reason: 'Catálogo no encontrado.' }, error: null }
        }
        if (cfg.catalog_enabled === false) {
          return { data: { available: false, reason: 'Este catálogo digital está desactivado temporalmente.' }, error: null }
        }
        const cats = getTable('categories')
        const piMap = new Map(getTable('product_images').map(r => [String(r.product_id), String(r.image_url || '')]))
        return {
          data: {
            available: true,
            company: {
              company_id: cfg.company_id || DEMO_COMPANY_ID,
              catalog_slug: cfg.catalog_slug ?? null,
              name: cfg.name || 'Comercial Demo',
              rif: cfg.rif || null,
              email: cfg.email || null,
              phone: cfg.phone || null,
              address: cfg.address || null,
              currency: cfg.currency || 'USD',
              tax_rate: Number(cfg.tax_rate) || 0,
              tax_mode: cfg.tax_mode || 'none',
              show_wholesale: cfg.catalog_show_wholesale !== false,
              show_stock: cfg.catalog_show_stock !== false,
              welcome: cfg.catalog_welcome ?? null,
              logo_url: cfg.logo_url ?? null,
              brand_theme: cfg.brand_theme || 'emerald',
              fx_rates: cfg.fx_rates || {},
              payment_methods: cfg.catalog_payment_methods || [],
              delivery_modes: cfg.catalog_delivery_modes || ['pickup', 'delivery'],
              whatsapp_settings: cfg.whatsapp_settings || {},
            },
            categories: cats.map(c => ({ id: c.id, name: c.name })),
            products: prods
              .filter(p => p.catalog_visible !== false)
              .sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)) || String(a.name).localeCompare(String(b.name)))
              .map(p => {
                const cat = cats.find(c => c.id === p.category_id)
                const imgFromTable = piMap.get(String(p.id))
                return {
                  id: p.id,
                  name: p.name,
                  sku: p.sku || '',
                  description: p.description ?? null,
                  featured: Boolean(p.featured),
                  category_id: p.category_id || null,
                  category_name: cat?.name || null,
                  price: Number(p.price) || 0,
                  price_wholesale: cfg.catalog_show_wholesale !== false ? (p.price_wholesale ?? null) : null,
                  wholesale_min_qty: cfg.catalog_show_wholesale !== false ? (p.wholesale_min_qty ?? null) : null,
                  unit: p.unit || 'unidad',
                  stock: Number(p.stock) || 0,
                  in_stock: (Number(p.stock) || 0) > 0,
                  image_url: imgFromTable || p.image_url || null,
                  variant_group_label: p.variant_group_label ?? null,
                  variants: Array.isArray(p.variants) ? p.variants : [],
                }
              }),
          },
          error: null,
        }
      }
      case 'obtener_metadatos_enlace_tienda': {
        const cfg = getTable('company_config')[0]
        const targetRaw = String(args.p_slug_or_id || '').trim().toLowerCase()
        const cfgSlug = String(cfg?.catalog_slug || '').trim().toLowerCase()
        const cfgId = String(cfg?.company_id || DEMO_COMPANY_ID).trim().toLowerCase()
        if (
          !cfg ||
          !targetRaw ||
          (targetRaw !== cfgId &&
            targetRaw !== DEMO_COMPANY_ID.toLowerCase() &&
            targetRaw !== 'co-demo-1' &&
            (!cfgSlug || targetRaw !== cfgSlug))
        ) {
          return { data: { found: false }, error: null }
        }
        return {
          data: {
            found: true,
            catalog_enabled: cfg.catalog_enabled !== false,
            company_id: cfg.company_id || DEMO_COMPANY_ID,
            catalog_slug: cfg.catalog_slug ?? null,
            name: cfg.name || 'Comercial Demo',
            rif: cfg.rif || null,
            phone: cfg.phone || null,
            address: cfg.address || null,
            welcome: cfg.catalog_welcome ?? null,
            logo_url: cfg.logo_url ?? null,
            brand_theme: cfg.brand_theme || 'emerald',
            whatsapp_settings: cfg.whatsapp_settings || {},
            products_count: prods.filter(p => p.catalog_visible !== false).length,
          },
          error: null,
        }
      }
      case 'verificar_stock_catalogo_publico': {
        const cfg = getTable('company_config')[0]
        const prodId = String(args.p_product_id || '')
        const reqBase = Math.max(0.01, Number(args.p_requested_base_qty) || 1)
        if (!cfg || cfg.catalog_enabled === false) {
          return {
            data: { found: false, available: false, reason: 'Catálogo no disponible.' },
            error: null,
          }
        }
        const prod = prods.find(x => String(x.id) === prodId)
        if (!prod || prod.catalog_visible === false) {
          return {
            data: { found: false, available: false, stock: 0, in_stock: false },
            error: null,
          }
        }
        const liveStock = Math.max(0, Number(prod.stock) || 0)
        return {
          data: {
            found: true,
            available: true,
            product_id: prod.id,
            stock: liveStock,
            in_stock: liveStock > 0,
            sufficient: liveStock >= reqBase,
            unit: prod.unit || 'unidad',
            variants: Array.isArray(prod.variants) ? prod.variants : [],
          },
          error: null,
        }
      }
      case 'crear_pedido_catalogo_publico': {
        const cfg = getTable('company_config')[0] || {}
        const reqItems: Row[] = Array.isArray(args.p_items) ? args.p_items : []
        const builtItems = reqItems
          .map(it => {
            const p = prods.find(x => x.id === it.product_id)
            if (!p) return null
            const qty = Number(it.quantity) || 0
            if (qty <= 0) return null
            const vid = it.variant_id ? String(it.variant_id) : null
            const matchedVar =
              vid && Array.isArray(p.variants)
                ? (p.variants as Row[]).find(v => String(v.id) === vid)
                : null
            const basePrice = matchedVar ? Number(matchedVar.price) : Number(p.price)
            const wholesalePrice = matchedVar
              ? Number(matchedVar.price_wholesale || 0)
              : Number(p.price_wholesale || 0)
            const mult = matchedVar ? Math.max(0.001, Number(matchedVar.stock_multiplier) || 1) : 1
            const useWholesale =
              cfg.catalog_show_wholesale !== false &&
              wholesalePrice > 0 &&
              Number(p.wholesale_min_qty) > 0 &&
              qty >= Number(p.wholesale_min_qty)
            const unitPrice = useWholesale ? wholesalePrice : basePrice
            const sub = Math.round(qty * unitPrice * 100) / 100
            return {
              product_id: p.id,
              product_name: p.name,
              sku: p.sku || '',
              variant_id: vid,
              variant_label: matchedVar ? String(matchedVar.label) : (it.variant_label ? String(it.variant_label) : null),
              stock_multiplier: mult,
              quantity: qty,
              unit_price: unitPrice,
              price: unitPrice,
              subtotal: sub,
              unit: p.unit || 'unidad',
              image_url: p.image_url || null,
            }
          })
          .filter(Boolean) as Row[]

        if (builtItems.length === 0) {
          return { data: null, error: { message: 'Agrega al menos un producto válido' } }
        }

        const sum = Math.round(builtItems.reduce((s, i) => s + Number(i.subtotal), 0) * 100) / 100
        const taxRate = Number(cfg.tax_rate) || 0
        const taxMode = String(cfg.tax_mode || 'none')
        let subtotal = sum
        let taxAmount = 0
        let total = sum
        if (taxMode === 'adicional' && taxRate > 0) {
          taxAmount = Math.round(sum * (taxRate / 100) * 100) / 100
          total = Math.round((sum + taxAmount) * 100) / 100
        } else if (taxMode === 'incluido' && taxRate > 0) {
          taxAmount = Math.round((sum - sum / (1 + taxRate / 100)) * 100) / 100
          subtotal = Math.round((sum - taxAmount) * 100) / 100
        }

        const catalogOrders = getTable('catalog_orders')
        const orderNumber = `WEB-${1001 + catalogOrders.length}`
        const phoneStr = String(args.p_phone || '')
        const phoneDigits = phoneStr.replace(/\D/g, '')
        const trackingPin =
          phoneDigits.length >= 4
            ? phoneDigits.slice(-4)
            : String(Math.floor(1000 + Math.random() * 9000))

        const payMethod = String(args.p_payment_method || 'pago_movil')
        const payStatus =
          payMethod === 'efectivo_entrega' ? 'contra_entrega' : 'pendiente_verificacion'

        const quoteId = genId()
        getTable('quotations').unshift({
          id: quoteId,
          customer_id: null,
          customer_name: `${args.p_customer_name || 'Cliente Web'} (${phoneStr})`.trim(),
          items: builtItems.map(b => ({
            product_id: b.product_id,
            product_name: b.variant_label ? `${b.product_name} (${b.variant_label})` : b.product_name,
            quantity: b.quantity,
            price: b.unit_price,
            subtotal: b.subtotal,
          })),
          subtotal,
          tax_rate: taxAmount > 0 ? taxRate : 0,
          tax_amount: taxAmount,
          total,
          status: 'enviada',
          valid_until: new Date(Date.now() + 7 * 86400000).toLocaleDateString('sv-SE'),
          created_at: nowIso(),
        })

        const orderId = genId()
        catalogOrders.unshift({
          id: orderId,
          company_id: cfg.company_id || DEMO_COMPANY_ID,
          order_number: orderNumber,
          tracking_pin: trackingPin,
          customer_id: null,
          customer_type: args.p_customer_type === 'juridica' ? 'juridica' : 'natural',
          customer_name: String(args.p_customer_name || 'Cliente Web'),
          customer_document: args.p_document ? String(args.p_document) : null,
          contact_person: args.p_contact_person ? String(args.p_contact_person) : null,
          requires_invoice: Boolean(args.p_requires_invoice),
          customer_phone: phoneStr,
          customer_email: args.p_email ? String(args.p_email) : null,
          delivery_mode: String(args.p_delivery_mode || 'pickup'),
          delivery_address: args.p_address ? String(args.p_address) : null,
          notes: args.p_notes ? String(args.p_notes) : null,
          items: builtItems,
          currency: cfg.currency || 'USD',
          fx_currency: args.p_fx_currency ? String(args.p_fx_currency) : null,
          fx_rate: args.p_fx_rate ? Number(args.p_fx_rate) : null,
          subtotal,
          tax_rate: taxAmount > 0 ? taxRate : 0,
          tax_amount: taxAmount,
          total,
          payment_method: payMethod,
          payment_reference: args.p_payment_reference ? String(args.p_payment_reference) : null,
          payment_sender_bank: args.p_payment_bank ? String(args.p_payment_bank) : null,
          payment_amount_reported: args.p_payment_amount ? Number(args.p_payment_amount) : total,
          payment_proof_url: args.p_payment_proof_url ? String(args.p_payment_proof_url) : null,
          payment_status: payStatus,
          order_status: 'nuevo',
          verified_by: null,
          verified_by_name: null,
          verified_at: null,
          admin_notes: null,
          sale_id: null,
          quotation_id: quoteId,
          created_at: nowIso(),
          updated_at: nowIso(),
        })

        return {
          data: {
            ok: true,
            order_id: orderId,
            quotation_id: quoteId,
            order_number: orderNumber,
            tracking_pin: trackingPin,
            payment_status: payStatus,
            order_status: 'nuevo',
            total,
            subtotal,
            tax_amount: taxAmount,
            currency: cfg.currency || 'USD',
            company_phone: cfg.phone || null,
            company_name: cfg.name || 'Comercial Demo',
          },
          error: null,
        }
      }
      case 'consultar_pedido_catalogo_publico': {
        const code = String(args.p_order_number || '').trim().toUpperCase()
        const secret = String(args.p_pin_or_phone || '').replace(/\D/g, '')
        const ord = getTable('catalog_orders').find(
          o => String(o.order_number || '').toUpperCase() === code
        )
        if (!ord) {
          return {
            data: { found: false, reason: 'No encontramos un pedido con ese código en este catálogo.' },
            error: null,
          }
        }
        const phoneDigits = String(ord.customer_phone || '').replace(/\D/g, '')
        const matches =
          secret.length >= 4 &&
          (String(ord.tracking_pin) === secret.slice(-4) ||
            phoneDigits.slice(-4) === secret.slice(-4) ||
            phoneDigits === secret)
        if (!matches) {
          return {
            data: { found: false, reason: 'El PIN o teléfono ingresado no coincide con el titular del pedido.' },
            error: null,
          }
        }
        return {
          data: {
            found: true,
            order: {
              order_number: ord.order_number,
              customer_name: ord.customer_name,
              customer_type: ord.customer_type,
              total: Number(ord.total) || 0,
              currency: ord.currency || 'USD',
              payment_method: ord.payment_method,
              payment_reference: ord.payment_reference || null,
              payment_status: ord.payment_status,
              order_status: ord.order_status,
              delivery_mode: ord.delivery_mode,
              verified_at: ord.verified_at || null,
              admin_notes: ord.admin_notes || null,
              created_at: ord.created_at,
              items: ord.items || [],
            },
          },
          error: null,
        }
      }
      case 'gestionar_pedido_catalogo': {
        const ord = getTable('catalog_orders').find(o => o.id === args.p_order_id)
        if (!ord) {
          return { data: null, error: { message: 'Pedido no encontrado' } }
        }
        ord.payment_status = String(args.p_payment_status || ord.payment_status)
        ord.order_status = String(args.p_order_status || ord.order_status)
        ord.admin_notes = args.p_admin_notes ? String(args.p_admin_notes) : null
        if (args.p_sale_id) ord.sale_id = String(args.p_sale_id)
        if (ord.payment_status === 'verificado' && !ord.verified_at) {
          ord.verified_by = currentSession?.user?.id || 'demo-dueno-1'
          ord.verified_by_name =
            currentSession?.user?.user_metadata?.full_name ||
            currentSession?.user?.email ||
            'Valentina Morales'
          ord.verified_at = nowIso()
        }
        ord.updated_at = nowIso()
        return {
          data: {
            ok: true,
            order_id: ord.id,
            payment_status: ord.payment_status,
            order_status: ord.order_status,
          },
          error: null,
        }
      }
      case 'listar_despachos_ruta': {
        const fromStr = String(args.p_from || '0000-01-01')
        const toStr = String(args.p_to || '9999-12-31')
        const rows = getTable('route_dispatches').filter(
          d => String(d.dispatch_date) >= fromStr && String(d.dispatch_date) <= toStr
        )
        return { data: rows, error: null }
      }
      case 'crear_despacho_ruta': {
        const seller = getTable('profiles').find(x => x.id === args.p_seller_id)
        const mp = getTable('member_profiles').find(x => x.user_id === args.p_seller_id)
        const rawItems: Row[] = Array.isArray(args.p_items) ? args.p_items : []
        const items = rawItems.map(it => {
          const p = prods.find(x => x.id === it.product_id)
          const loaded = Number(it.qty_loaded) || 0
          return {
            id: genId(),
            product_id: it.product_id,
            product_name: p?.name || 'Producto',
            sku: p?.sku || '',
            unit: p?.unit || 'unidad',
            unit_price: Number(p?.price) || 0,
            qty_loaded: loaded,
            qty_sold: 0,
            qty_expected_return: loaded,
            qty_returned: null,
            qty_diff: null,
          }
        })
        const opening = Math.max(0, Number(args.p_opening_cash) || 0)
        const dispatch: Row = {
          id: genId(),
          seller_id: args.p_seller_id,
          seller_name: seller?.full_name || seller?.email || 'Vendedor',
          dispatch_date: args.p_date || new Date().toLocaleDateString('sv-SE'),
          vehicle_label: args.p_vehicle_label ?? null,
          zone: mp?.zone ?? null,
          opening_cash: opening,
          status: 'abierto',
          sales_cash: 0,
          sales_bank: 0,
          sales_credit: 0,
          collections_cash: 0,
          collections_bank: 0,
          expected_cash: opening,
          delivered_cash: null,
          cash_diff: null,
          notes: args.p_notes ?? null,
          closed_at: null,
          closed_by_name: null,
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
          items,
        }
        getTable('route_dispatches').unshift(dispatch)
        return { data: dispatch.id, error: null }
      }
      case 'liquidar_despacho_ruta': {
        const d = getTable('route_dispatches').find(x => x.id === args.p_dispatch_id)
        if (!d) return { data: null, error: { message: 'Hoja de despacho no encontrada' } }
        const returns: Row[] = Array.isArray(args.p_returns) ? args.p_returns : []
        for (const it of (d.items || [])) {
          const r = returns.find(x => x.item_id === it.id)
          const retQty = r ? Number(r.qty_returned) || 0 : Number(it.qty_expected_return) || 0
          it.qty_returned = retQty
          it.qty_diff = Math.round((retQty - Number(it.qty_expected_return || 0)) * 100) / 100
        }
        const delivered = Math.max(0, Number(args.p_delivered_cash) || 0)
        d.delivered_cash = delivered
        d.cash_diff = Math.round((delivered - Number(d.expected_cash || 0)) * 100) / 100
        d.notes = args.p_notes ?? d.notes
        d.status = 'liquidado'
        d.closed_at = nowIso()
        d.closed_by_name = 'Administrador Demo'
        return { data: { ok: true }, error: null }
      }
      case 'anular_despacho_ruta': {
        const d = getTable('route_dispatches').find(x => x.id === args.p_dispatch_id)
        if (d) d.status = 'anulado'
        return { data: { ok: true }, error: null }
      }
      case 'registrar_movimiento_nomina': {
        const member = getTable('profiles').find(x => x.id === args.p_user_id)
        if (!member) return { data: null, error: { message: 'Miembro no encontrado' } }
        const amt = Math.round((Number(args.p_amount) || 0) * 100) / 100
        const id = genId()
        const mov: Row = {
          id,
          user_id: member.id,
          member_name: member.full_name || member.email,
          type: args.p_type || 'adelanto',
          amount: amt,
          method: args.p_method || 'efectivo',
          movement_date: args.p_date || new Date().toLocaleDateString('sv-SE'),
          reason: args.p_reason || '',
          status: 'pendiente',
          expense_id: null,
          payment_id: null,
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
        }
        getTable('payroll_movements').unshift(mov)
        return { data: id, error: null }
      }
      case 'previsualizar_liquidacion_nomina': {
        const mp = getTable('member_profiles').find(x => x.user_id === args.p_user_id)
        const baseSalary = Number(mp?.base_salary) || 0
        const commPct = Number(mp?.commission_pct) || 0
        const fromStr = String(args.p_from || '0000-01-01')
        const toStr = String(args.p_to || '9999-12-31')
        const sellerSales = sales.filter(
          s => s.seller_id === args.p_user_id && String(s.created_at).slice(0, 10) >= fromStr && String(s.created_at).slice(0, 10) <= toStr
        )
        const salesAmt = Math.round(sellerSales.reduce((acc, s) => acc + (Number(s.total) || 0), 0) * 100) / 100
        const commAmt = Math.round(salesAmt * commPct) / 100
        const pendingMovs = getTable('payroll_movements').filter(m => m.user_id === args.p_user_id && m.status === 'pendiente')
        const advances = pendingMovs.filter(m => m.type === 'adelanto').reduce((a, m) => a + Number(m.amount || 0), 0)
        const bonuses = pendingMovs.filter(m => m.type === 'bono').reduce((a, m) => a + Number(m.amount || 0), 0)
        const deductions = pendingMovs.filter(m => m.type === 'descuento').reduce((a, m) => a + Number(m.amount || 0), 0)
        return {
          data: {
            base_salary: baseSalary,
            commission_pct: commPct,
            sales_amount: salesAmt,
            sales_count: sellerSales.length,
            commission_amount: commAmt,
            advances_amount: Math.round(advances * 100) / 100,
            bonuses_amount: Math.round(bonuses * 100) / 100,
            deductions_amount: Math.round(deductions * 100) / 100,
            overlapping_payments: 0,
          },
          error: null,
        }
      }
      case 'liquidar_pago_nomina': {
        const member = getTable('profiles').find(x => x.id === args.p_user_id)
        if (!member) return { data: null, error: { message: 'Miembro no encontrado' } }
        const pendingMovs = getTable('payroll_movements').filter(m => m.user_id === args.p_user_id && m.status === 'pendiente')
        const advances = pendingMovs.filter(m => m.type === 'adelanto').reduce((a, m) => a + Number(m.amount || 0), 0)
        const bonuses = pendingMovs.filter(m => m.type === 'bono').reduce((a, m) => a + Number(m.amount || 0), 0)
        const deductions = pendingMovs.filter(m => m.type === 'descuento').reduce((a, m) => a + Number(m.amount || 0), 0)
        const baseAmt = Number(args.p_base_amount) || 0
        const commAmt = Number(args.p_commission_amount) || 0
        const netPaid = Math.max(0, Math.round((baseAmt + commAmt + bonuses - deductions - advances) * 100) / 100)
        const payId = genId()
        for (const m of pendingMovs) {
          m.status = 'aplicado'
          m.payment_id = payId
        }
        getTable('payroll_payments').unshift({
          id: payId,
          user_id: member.id,
          member_name: member.full_name || member.email,
          period_from: args.p_from,
          period_to: args.p_to,
          payment_date: args.p_payment_date || new Date().toLocaleDateString('sv-SE'),
          base_amount: baseAmt,
          sales_amount: Number(args.p_sales_amount) || 0,
          commission_pct: Number(args.p_commission_pct) || 0,
          commission_amount: commAmt,
          bonuses_amount: bonuses,
          deductions_amount: deductions,
          advances_deducted: advances,
          net_paid: netPaid,
          method: args.p_method || 'efectivo',
          reference: args.p_reference ?? null,
          notes: args.p_notes ?? null,
          status: 'activo',
          created_by_name: 'Administrador Demo',
          created_at: nowIso(),
        })
        return { data: payId, error: null }
      }
      case 'anular_pago_nomina': {
        const pay = getTable('payroll_payments').find(x => x.id === args.p_payment_id)
        if (pay) {
          pay.status = 'anulado'
          for (const m of getTable('payroll_movements')) {
            if (m.payment_id === pay.id) {
              m.status = 'pendiente'
              m.payment_id = null
            }
          }
        }
        return { data: null, error: null }
      }
      case 'anular_movimiento_nomina': {
        const mov = getTable('payroll_movements').find(x => x.id === args.p_movement_id)
        if (mov) mov.status = 'anulado'
        return { data: null, error: null }
      }
      case 'resumen_diario': {
        const dStr = String(args.p_date || new Date().toLocaleDateString('sv-SE'))
        const daySales = sales.filter(s => String(s.created_at || '').slice(0, 10) === dStr)
        const total = Math.round(daySales.reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
        const byMethod: Record<string, number> = {}
        const prodMap = new Map<string, { name: string; qty: number; amount: number }>()
        for (const s of daySales) {
          const m = s.payment_method || 'efectivo'
          byMethod[m] = Math.round(((byMethod[m] || 0) + Number(s.total || 0)) * 100) / 100
          for (const it of (s.items || [])) {
            const cur = prodMap.get(it.product_id) || { name: it.product_name || 'Producto', qty: 0, amount: 0 }
            cur.qty += Number(it.quantity) || 0
            cur.amount = Math.round((cur.amount + (Number(it.subtotal) || 0)) * 100) / 100
            prodMap.set(it.product_id, cur)
          }
        }
        const cashIn = getTable('cash_entries').filter(e => e.type === 'ingreso' && String(e.created_at || '').slice(0, 10) === dStr).reduce((a, e) => a + Number(e.amount || 0), 0)
        const cashOut = getTable('cash_entries').filter(e => e.type === 'egreso' && String(e.created_at || '').slice(0, 10) === dStr).reduce((a, e) => a + Number(e.amount || 0), 0)
        const sinStock = prods.filter(p => Number(p.stock) <= 0).length
        const bajoMin = prods.filter(p => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock)).length
        return {
          data: {
            date: dStr,
            sales: {
              total,
              count: daySales.length,
              avg: daySales.length ? Math.round((total / daySales.length) * 100) / 100 : 0,
              prev_day: 58,
              same_weekday_last_week: 69.6,
              by_method: byMethod,
            },
            top_products: [...prodMap.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
            cash: { ingresos: Math.round(cashIn * 100) / 100, egresos: Math.round(cashOut * 100) / 100 },
            returns: { count: 0, amount: 0 },
            purchases: 0,
            stock: { sin_stock: sinStock, bajo_minimo: bajoMin },
            cartera: { por_cobrar: 19.5, vencido: 0, ventas_fiado: daySales.filter(s => s.payment_method === 'fiado').length, abonos: 0 },
          },
          error: null,
        }
      }
      case 'rentabilidad_productos': {
        const rows = prods.map((p, idx) => {
          const soldUnits = sales.reduce((acc, s) => acc + (s.items || []).filter((i: Row) => i.product_id === p.id).reduce((a: number, i: Row) => a + (Number(i.quantity) || 0), 0), 0)
          const revenue = Math.round(sales.reduce((acc, s) => acc + (s.items || []).filter((i: Row) => i.product_id === p.id).reduce((a: number, i: Row) => a + (Number(i.subtotal) || 0), 0), 0) * 100) / 100
          const cost = Math.round(soldUnits * (Number(p.cost) || 0) * 100) / 100
          const profit = Math.round((revenue - cost) * 100) / 100
          const marginPct = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : null
          return {
            product_id: p.id,
            name: p.name,
            sku: p.sku || null,
            units: soldUnits,
            returned_units: 0,
            revenue,
            cost,
            profit,
            margin_pct: marginPct,
            unit_profit: soldUnits > 0 ? Math.round((profit / soldUnits) * 100) / 100 : null,
            share_of_profit_pct: idx === 0 ? 60 : 20,
            abc: (idx === 0 ? 'A' : idx === 1 ? 'B' : 'C') as 'A' | 'B' | 'C',
            prev_profit: Math.round(profit * 0.85 * 100) / 100,
            profit_change_pct: profit > 0 ? 15 : null,
            flags: [] as string[],
          }
        })
        const totalRev = Math.round(rows.reduce((a, r) => a + r.revenue, 0) * 100) / 100
        const totalCost = Math.round(rows.reduce((a, r) => a + r.cost, 0) * 100) / 100
        const totalProfit = Math.round((totalRev - totalCost) * 100) / 100
        return {
          data: {
            from: args.p_from || '',
            to: args.p_to || '',
            days: 30,
            method: 'costo_actual',
            summary: {
              products: rows.length,
              revenue: totalRev,
              cost: totalCost,
              profit: totalProfit,
              prev_profit: Math.round(totalProfit * 0.85 * 100) / 100,
              margin_pct: totalRev > 0 ? Math.round((totalProfit / totalRev) * 1000) / 10 : 0,
              profit_change_pct: 15,
              losing: 0,
              low_margin: 0,
              no_cost: 0,
              class_a: 1,
            },
            rows,
          },
          error: null,
        }
      }
      case 'pred_customers': {
        const rows = custs.map((c, idx) => ({
          customer_id: c.id,
          name: c.name,
          phone: c.phone || null,
          segment: idx === 0 ? 'recurrente' : idx === 1 ? 'recuperable' : 'nuevo',
          risk: idx === 1 ? 'medio' : 'ninguno',
          confidence: 'media',
          orders: idx === 0 ? 3 : 1,
          last_purchase: new Date(Date.now() - idx * 86400000 * 2).toLocaleDateString('sv-SE'),
          days_since: idx * 2,
          usual_interval_days: 7,
          spend_recent_90: idx === 0 ? 92.8 : 37.5,
          spend_prev_90: 80,
          spend_change_pct: 16,
          avg_ticket: 45,
          monthly_avg: 90,
          reasons: idx === 1 ? ['Lleva más días de lo habitual sin comprar'] : ['Frecuencia estable'],
        }))
        return {
          data: {
            window_days: Number(args.p_days) || 365,
            method: 'frecuencia_recencia',
            summary: {
              total: rows.length,
              by_segment: { recurrente: 1, recuperable: 1, nuevo: 1 },
              by_risk: { medio: 1, ninguno: 2 },
              monthly_at_risk: 45,
            },
            rows,
          },
          error: null,
        }
      }
      case 'pred_products': {
        const rows = prods.map(p => {
          const st = Number(p.stock) || 0
          const min = Number(p.min_stock) || 0
          const status = st <= 0 ? 'agotado' : st <= min ? 'bajo_minimo' : 'ok'
          return {
            product_id: p.id,
            name: p.name,
            sku: p.sku || null,
            category_id: p.category_id || null,
            status,
            confidence: 'media',
            observed: {
              stock: st,
              min_stock: min,
              units_7d: 8,
              units_28d: 24,
              units_84d: 60,
              returned_84d: 0,
              active_weeks_of_12: 8,
              weekly_series: [4, 6, 5, 7, 6, 8, 5, 7, 6, 8, 7, 8],
              stock_value_at_cost: Math.round(st * (Number(p.cost) || 0) * 100) / 100,
            },
            estimated: {
              rate_per_day: 1,
              days_left: st,
              demand_next_30d: 30,
              shortfall_next_30d: Math.max(0, 30 - st),
            },
            trend: { label: 'estable', change_pct_4w: 4 },
            anomaly: null,
            suggestion: st <= min ? { qty: Math.max(10, min * 2 - st), supplier: 'Distribuidora Nacional C.A.' } : null,
            notes: [],
          }
        })
        return {
          data: {
            cover_days: Number(args.p_cover_days) || 15,
            method: 'promedio_ponderado',
            summary: {
              total: rows.length,
              by_status: {
                agotado: rows.filter(r => r.status === 'agotado').length,
                bajo_minimo: rows.filter(r => r.status === 'bajo_minimo').length,
                ok: rows.filter(r => r.status === 'ok').length,
              },
              growing: 0,
              declining: 0,
              anomalies: 0,
              immobilized_value: 0,
            },
            rows,
          },
          error: null,
        }
      }
      case 'lotes_list': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const lots = getTable('product_lots')
        const tracked = prods.filter(p => p.tracks_expiry)
        const sinLote = tracked
          .map(p => {
            const inLots = lots.filter(l => l.product_id === p.id).reduce((a, l) => a + Number(l.qty_remaining || 0), 0)
            const missing = Math.max(0, (Number(p.stock) || 0) - inLots)
            return { product_id: p.id, name: p.name, stock: Number(p.stock) || 0, in_lots: inLots, missing }
          })
          .filter(x => x.missing > 0)
        return {
          data: {
            today: todayStr,
            lots,
            sin_lote: sinLote,
            descuadre: sinLote.reduce((a, x) => a + x.missing, 0),
          },
          error: null,
        }
      }
      case 'agregar_lote': {
        const prod = prods.find(p => p.id === args.p_product)
        if (!prod) return { data: null, error: { message: 'Producto no encontrado' } }
        const exp = String(args.p_expiry || new Date().toLocaleDateString('sv-SE'))
        const daysLeft = Math.floor((new Date(exp + 'T00:00:00').getTime() - new Date(new Date().toLocaleDateString('sv-SE') + 'T00:00:00').getTime()) / 86400000)
        getTable('product_lots').push({
          id: genId(),
          product_id: prod.id,
          product_name: prod.name,
          lot_code: args.p_code || 'LOTE-1',
          expiry_date: exp,
          days_left: daysLeft,
          qty_remaining: Number(args.p_qty) || 0,
          qty_initial: Number(args.p_qty) || 0,
          cost: Number(prod.cost) || 0,
        })
        return { data: null, error: null }
      }
      case 'dar_baja_lote': {
        const lots = getTable('product_lots')
        const idx = lots.findIndex(l => l.id === args.p_lot_id)
        if (idx >= 0) {
          const lot = lots[idx]
          const prod = prods.find(p => p.id === lot.product_id)
          if (prod) prod.stock = Math.max(0, (Number(prod.stock) || 0) - (Number(lot.qty_remaining) || 0))
          lots.splice(idx, 1)
        }
        return { data: null, error: null }
      }
      case 'lotes_cuadrar':
        return { data: 0, error: null }
      case 'acc_post_pending':
        return {
          data: { ventas: 0, compras: 0, abonos: 0, pagos_proveedor: 0, gastos: 0, devoluciones: 0, devoluciones_compra: 0, caja: 0, ajustes: 0 },
          error: null,
        }
      case 'acc_reconcile': {
        const postedIds = new Set(getTable('acc_entries').filter(e => e.status === 'contabilizado').map(e => e.id))
        const allLines = getTable('acc_lines').filter(l => postedIds.has(l.entry_id))
        const sumAcc = (accId: string, nature: 'debito' | 'credito') => {
          const ls = allLines.filter(l => l.account_id === accId)
          const d = ls.reduce((s, l) => s + (Number(l.debit) || 0), 0)
          const c = ls.reduce((s, l) => s + (Number(l.credit) || 0), 0)
          return Math.round((nature === 'debito' ? d - c : c - d) * 100) / 100
        }
        const ventasCont = sumAcc('acc-7', 'credito')
        const gastosCont = sumAcc('acc-9', 'debito')
        const invCont = sumAcc('acc-4', 'debito')
        const cxcCont = sumAcc('acc-3', 'debito')
        return {
          data: [
            {
              code: 'ventas',
              label: 'Ingresos por ventas facturadas vs. Cuenta 4101',
              operational: ventasCont,
              accounting: ventasCont,
              difference: 0,
              note: 'Todas las ventas activas del período están mayorizadas.',
            },
            {
              code: 'inventario',
              label: 'Valorización Kardex a costo vs. Cuenta 1104',
              operational: invCont,
              accounting: invCont,
              difference: 0,
              note: 'Existencias valorizadas a costo promedio coinciden con el mayor.',
            },
            {
              code: 'cartera',
              label: 'Auxiliar de Cartera Clientes vs. Cuenta 1103',
              operational: cxcCont,
              accounting: cxcCont,
              difference: 0,
              note: 'Saldos por cobrar de clientes conciliados.',
            },
            {
              code: 'gastos',
              label: 'Gastos operativos activos vs. Cuenta 6101',
              operational: gastosCont,
              accounting: gastosCont,
              difference: 0,
              note: 'Comprobantes de egreso contabilizados.',
            },
          ],
          error: null,
        }
      }
      case 'acc_save_settings': {
        const st = getTable('acc_settings')
        if (st.length) st[0].map = args.p_map || {}
        else st.push({ id: 'acc-st-1', active: false, start_date: null, timezone: 'America/Caracas', map: args.p_map || {} })
        return { data: null, error: null }
      }
      case 'acc_activate': {
        const st = getTable('acc_settings')
        if (st.length) {
          st[0].active = Boolean(args.p_active)
          st[0].start_date = args.p_start || null
        } else {
          st.push({ id: 'acc-st-1', active: Boolean(args.p_active), start_date: args.p_start || null, timezone: 'America/Caracas', map: {} })
        }
        return { data: null, error: null }
      }
      case 'acc_seed_template':
        return { data: null, error: null }
      case 'acc_upsert_account': {
        const accs = getTable('acc_accounts')
        if (args.p_id) {
          const ex = accs.find(a => a.id === args.p_id)
          if (ex) {
            ex.code = args.p_code
            ex.name = args.p_name
            ex.type = args.p_type
            ex.nature = args.p_nature
            ex.parent_id = args.p_parent ?? null
            ex.is_postable = Boolean(args.p_postable)
            ex.active = args.p_active !== false
          }
        } else {
          accs.push({
            id: genId(),
            code: String(args.p_code || '').trim(),
            name: String(args.p_name || '').trim(),
            type: args.p_type || 'activo',
            nature: args.p_nature || 'debito',
            parent_id: args.p_parent ?? null,
            is_postable: args.p_postable !== false,
            active: args.p_active !== false,
          })
        }
        return { data: null, error: null }
      }
      case 'acc_create_entry': {
        const entries = getTable('acc_entries')
        const accs = getTable('acc_accounts')
        const allLines = getTable('acc_lines')
        const id = genId()
        const num = `ASI-${String(entries.length + 1).padStart(4, '0')}`
        entries.unshift({
          id,
          number: num,
          entry_date: args.p_date || daysFromNowYmd(0),
          description: args.p_description || 'Asiento manual',
          status: args.p_post ? 'contabilizado' : 'borrador',
          source_type: 'manual',
        })
        for (const l of (args.p_lines || [])) {
          const ac = accs.find(a => a.id === l.account_id)
          allLines.push({
            id: genId(),
            entry_id: id,
            account_id: l.account_id,
            debit: Number(l.debit) || 0,
            credit: Number(l.credit) || 0,
            memo: l.memo || null,
            acc_accounts: ac ? { code: ac.code, name: ac.name } : null,
          })
        }
        return { data: id, error: null }
      }
      case 'acc_post_entry': {
        const e = getTable('acc_entries').find(x => x.id === args.p_entry_id)
        if (e) e.status = 'contabilizado'
        return { data: null, error: null }
      }
      case 'acc_reverse_entry': {
        const e = getTable('acc_entries').find(x => x.id === args.p_entry_id)
        if (e) e.status = 'reversado'
        return { data: null, error: null }
      }
      case 'acc_ledger': {
        const accId = args.p_account
        const ac = getTable('acc_accounts').find(a => a.id === accId)
        const postedEntries = new Map(
          getTable('acc_entries')
            .filter(e => e.status === 'contabilizado')
            .map(e => [e.id, e])
        )
        const rawLines = getTable('acc_lines').filter(l => l.account_id === accId && postedEntries.has(l.entry_id))
        let running = 0
        const out = rawLines.map((l, idx) => {
          const ent = postedEntries.get(l.entry_id)!
          const deb = Number(l.debit) || 0
          const cred = Number(l.credit) || 0
          running += ac?.nature === 'credito' ? cred - deb : deb - cred
          return {
            seq: idx + 1,
            entry_date: ent.entry_date,
            number: ent.number,
            description: l.memo || ent.description,
            debit: deb,
            credit: cred,
            balance: Math.round(running * 100) / 100,
            is_opening: false,
          }
        })
        return { data: out, error: null }
      }
      case 'acc_trial_balance': {
        const postedIds = new Set(getTable('acc_entries').filter(e => e.status === 'contabilizado').map(e => e.id))
        const allLines = getTable('acc_lines').filter(l => postedIds.has(l.entry_id))
        const out = getTable('acc_accounts')
          .filter(a => a.is_postable)
          .map(a => {
            const ls = allLines.filter(l => l.account_id === a.id)
            const deb = Math.round(ls.reduce((s, l) => s + (Number(l.debit) || 0), 0) * 100) / 100
            const cred = Math.round(ls.reduce((s, l) => s + (Number(l.credit) || 0), 0) * 100) / 100
            const net = Math.round((deb - cred) * 100) / 100
            return {
              account_id: a.id,
              code: a.code,
              name: a.name,
              opening_debit: 0,
              opening_credit: 0,
              period_debit: deb,
              period_credit: cred,
              closing_debit: net > 0 ? net : 0,
              closing_credit: net < 0 ? Math.abs(net) : 0,
            }
          })
          .filter(r => r.period_debit > 0 || r.period_credit > 0)
        return { data: out, error: null }
      }
      case 'acc_income_statement': {
        const postedIds = new Set(getTable('acc_entries').filter(e => e.status === 'contabilizado').map(e => e.id))
        const allLines = getTable('acc_lines').filter(l => postedIds.has(l.entry_id))
        const out = getTable('acc_accounts')
          .filter(a => ['ingreso', 'costo', 'gasto'].includes(a.type))
          .map(a => {
            const ls = allLines.filter(l => l.account_id === a.id)
            const deb = ls.reduce((s, l) => s + (Number(l.debit) || 0), 0)
            const cred = ls.reduce((s, l) => s + (Number(l.credit) || 0), 0)
            const amount = a.type === 'ingreso' ? cred - deb : deb - cred
            return { account_id: a.id, code: a.code, name: a.name, type: a.type, amount: Math.round(amount * 100) / 100 }
          })
          .filter(r => Math.abs(r.amount) > 0.004)
        return { data: out, error: null }
      }
      case 'acc_balance_sheet': {
        const postedIds = new Set(getTable('acc_entries').filter(e => e.status === 'contabilizado').map(e => e.id))
        const allLines = getTable('acc_lines').filter(l => postedIds.has(l.entry_id))
        const rowsOut: Row[] = []
        let netIncome = 0
        for (const a of getTable('acc_accounts')) {
          const ls = allLines.filter(l => l.account_id === a.id)
          const deb = ls.reduce((s, l) => s + (Number(l.debit) || 0), 0)
          const cred = ls.reduce((s, l) => s + (Number(l.credit) || 0), 0)
          if (['activo', 'pasivo', 'patrimonio'].includes(a.type)) {
            const amount = a.type === 'activo' ? deb - cred : cred - deb
            if (Math.abs(amount) > 0.004) {
              rowsOut.push({ account_id: a.id, code: a.code, name: a.name, type: a.type, amount: Math.round(amount * 100) / 100 })
            }
          } else if (a.type === 'ingreso') {
            netIncome += cred - deb
          } else if (a.type === 'costo' || a.type === 'gasto') {
            netIncome -= deb - cred
          }
        }
        if (Math.abs(netIncome) > 0.004) {
          rowsOut.push({
            account_id: null,
            code: '3901',
            name: 'Resultado del ejercicio en curso',
            type: 'resultado',
            amount: Math.round(netIncome * 100) / 100,
          })
        }
        return { data: rowsOut, error: null }
      }
      case 'acc_statement_status':
        return {
          data: [{ kind: 'nota', reason: 'Entorno de demostración con asientos cuadrados automáticamente.' }],
          error: null,
        }
      case 'acc_close_check':
        return {
          data: [
            { code: 'partidas', label: 'Partida doble cuadrada en todos los asientos', status: 'ok', detail: 'Débitos iguales a créditos' },
            { code: 'borradores', label: 'Sin asientos en borrador en el periodo', status: 'ok', detail: '0 borradores pendientes' },
            { code: 'conciliacion', label: 'Módulos operativos conciliados con libros', status: 'ok', detail: 'Caja, cartera e inventario alineados' },
          ],
          error: null,
        }
      case 'acc_close_period': {
        const closings = getTable('acc_closings')
        closings.unshift({
          id: genId(),
          year: Number(args.p_year),
          month: Number(args.p_month),
          status: 'cerrado',
          notes: args.p_notes || null,
          checks: [{ code: 'partidas', label: 'Partida doble cuadrada', status: 'ok', detail: 'Verificado' }],
          trial_balance: [],
          totals: { debitos: 3905.9, creditos: 3905.9 },
          closed_by_name: 'Valentina Morales',
          closed_at: nowIso(),
          reopened_by_name: null,
          reopened_at: null,
          reopen_reason: null,
        })
        return { data: null, error: null }
      }
      case 'acc_reopen_period': {
        const c = getTable('acc_closings').find(x => x.year === Number(args.p_year) && x.month === Number(args.p_month))
        if (c) {
          c.status = 'reabierto'
          c.reopened_by_name = 'Valentina Morales'
          c.reopened_at = nowIso()
          c.reopen_reason = args.p_reason || 'Ajuste contable'
        }
        return { data: null, error: null }
      }
      case 'ai_run_tool': {
        const tool = String(args.p_tool || '')
        const todayStr = new Date().toLocaleDateString('sv-SE')
        if (tool === 'resumen_financiero') {
          const comprasTotal = Math.round(getTable('purchases').filter(p => p.status !== 'anulada').reduce((s, p) => s + (Number(p.total) || 0), 0) * 100) / 100
          const ventasTotal = Math.round(sales.reduce((s, x) => s + (Number(x.total) || 0), 0) * 100) / 100
          const invCosto = Math.round(prods.reduce((s, p) => s + (Number(p.stock) || 0) * (Number(p.cost) || 0), 0) * 100) / 100
          const cashIn = Math.round(getTable('cash_entries').filter(e => e.type === 'ingreso').reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100
          const cashOut = Math.round(getTable('cash_entries').filter(e => e.type === 'egreso').reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100) / 100
          const fiados = sales.filter(s => s.payment_method === 'fiado')
          const porCobrar = Math.round(fiados.reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
          const vencido = Math.round(fiados.filter(s => s.due_date && s.due_date < todayStr).reduce((a, s) => a + Number(s.total || 0), 0) * 100) / 100
          return {
            data: {
              ok: true,
              tool: 'resumen_financiero',
              nature: 'mixto',
              generated_at: nowIso(),
              duration_ms: 4,
              data: {
                label: 'del mes',
                confirmado: {
                  ventas_total: ventasTotal,
                  ventas_cantidad: sales.length,
                  compras_total: comprasTotal,
                  caja_ingresos: cashIn,
                  caja_egresos: cashOut,
                  cartera_por_cobrar: porCobrar,
                  cartera_vencida: vencido,
                  valor_inventario_a_costo: invCosto,
                },
                estimado: { utilidad: Math.round(ventasTotal * 0.34 * 100) / 100, margen_pct: 34 },
              },
              notes: [],
            },
            error: null,
          }
        }
        if (tool === 'inventario_riesgo') {
          const items = prods
            .filter(p => Number(p.stock) <= Number(p.min_stock))
            .map(p => ({
              name: p.name,
              status: Number(p.stock) <= 0 ? 'agotado' : 'bajo_minimo',
              confidence: 'alta',
              observed: { stock: Number(p.stock) || 0, stock_value_at_cost: (Number(p.stock) || 0) * (Number(p.cost) || 0) },
              estimated: { days_left: Number(p.stock) > 0 ? Math.max(1, Math.round(Number(p.stock) / 1.2)) : 0 },
            }))
          return {
            data: { ok: true, tool: 'inventario_riesgo', nature: 'mixto', generated_at: nowIso(), duration_ms: 3, data: { items_total: items.length, items }, notes: [] },
            error: null,
          }
        }
        if (tool === 'reposicion') {
          const items = prods
            .filter(p => Number(p.stock) <= Number(p.min_stock))
            .map(p => {
              const qty = Math.max(6, (Number(p.min_stock) || 6) * 2 - (Number(p.stock) || 0))
              return {
                name: p.name,
                qty,
                stock: Number(p.stock) || 0,
                supplier_name: 'Distribuidora Nacional C.A.',
                line_total: qty * (Number(p.cost) || 0),
              }
            })
          const total = Math.round(items.reduce((a, i) => a + i.line_total, 0) * 100) / 100
          return {
            data: { ok: true, tool: 'reposicion', nature: 'recomendacion', generated_at: nowIso(), duration_ms: 3, data: { items_total: items.length, total, items }, notes: [] },
            error: null,
          }
        }
        if (tool === 'clientes_dormidos') {
          const items = [{ name: 'María Gómez', risk: 'medio', days_since: 16, usual_interval_days: 7 }]
          return {
            data: { ok: true, tool: 'clientes_dormidos', nature: 'estimado', generated_at: nowIso(), duration_ms: 3, data: { items_total: items.length, items }, notes: [] },
            error: null,
          }
        }
        if (tool === 'cartera') {
          const fiados = sales.filter(s => s.payment_method === 'fiado')
          const items = fiados.map(s => ({
            name: s.customer_name || 'Cliente',
            owed: Number(s.total) || 0,
            overdue: s.due_date && s.due_date < todayStr ? Number(s.total) || 0 : 0,
          }))
          const totalOwed = Math.round(items.reduce((a, i) => a + i.owed, 0) * 100) / 100
          const totalOverdue = Math.round(items.reduce((a, i) => a + i.overdue, 0) * 100) / 100
          return {
            data: { ok: true, tool: 'cartera', nature: 'confirmado', generated_at: nowIso(), duration_ms: 3, data: { total_owed: totalOwed, total_overdue: totalOverdue, items_total: items.length, items }, notes: [] },
            error: null,
          }
        }
        if (tool === 'cuentas_por_pagar') {
          const pendingPurchases = getTable('purchases').filter(p => p.status !== 'anulada' && p.payment_method === 'credito' && Number(p.balance ?? p.total) > 0)
          const suppliersOut = pendingPurchases.map(p => ({
            name: p.supplier_name || 'Proveedor',
            owed: Number(p.balance ?? p.total) || 0,
            overdue: p.due_date && p.due_date < todayStr ? Number(p.balance ?? p.total) || 0 : 0,
          }))
          const totalOwed = Math.round(suppliersOut.reduce((a, s) => a + s.owed, 0) * 100) / 100
          const totalOverdue = Math.round(suppliersOut.reduce((a, s) => a + s.overdue, 0) * 100) / 100
          return {
            data: { ok: true, tool: 'cuentas_por_pagar', nature: 'confirmado', generated_at: nowIso(), duration_ms: 3, data: { total_owed: totalOwed, total_overdue: totalOverdue, suppliers: suppliersOut }, notes: [] },
            error: null,
          }
        }
        if (tool === 'rentabilidad') {
          const top = [
            { name: 'Café Molido Gourmet 500g', profit: 87.4, margin_pct: 36.2 },
            { name: 'Harina de Maíz Precocida 1kg', profit: 51.0, margin_pct: 24.0 },
            { name: 'Queso Blanco Pasteurizado 1kg', profit: 39.1, margin_pct: 23.9 },
          ]
          return {
            data: {
              ok: true,
              tool: 'rentabilidad',
              nature: 'mixto',
              generated_at: nowIso(),
              duration_ms: 3,
              data: {
                from: daysFromNowYmd(-29),
                to: todayStr,
                summary: { revenue: 819.14, profit: 268.4, margin_pct: 32.8 },
                top,
                attention: [],
              },
              notes: [],
            },
            error: null,
          }
        }
        if (tool === 'caja_resumen') {
          const ing = Math.round(getTable('cash_entries').filter(e => e.type === 'ingreso').reduce((a, e) => a + Number(e.amount || 0), 0) * 100) / 100
          const egr = Math.round(getTable('cash_entries').filter(e => e.type === 'egreso').reduce((a, e) => a + Number(e.amount || 0), 0) * 100) / 100
          return {
            data: {
              ok: true,
              tool: 'caja_resumen',
              nature: 'confirmado',
              generated_at: nowIso(),
              duration_ms: 3,
              data: {
                from: daysFromNowYmd(-29),
                to: todayStr,
                ingresos: ing,
                egresos: egr,
                neto_periodo: Math.round((ing - egr) * 100) / 100,
                saldo_actual: Math.round((450 + ing - egr) * 100) / 100,
                by_origin: [
                  { origin: 'sale', ingresos: ing, egresos: 0 },
                  { origin: 'manual', ingresos: 0, egresos: egr },
                ],
                gastos_manuales: getTable('expenses').slice(0, 3),
              },
              notes: [],
            },
            error: null,
          }
        }
        if (tool === 'vendedores') {
          return {
            data: {
              ok: true,
              tool: 'vendedores',
              nature: 'confirmado',
              generated_at: nowIso(),
              duration_ms: 3,
              data: {
                label: 'del mes',
                items: [
                  { name: 'Carlos Méndez', sales_total: 1245.5, sales_count: 18, visits: 22, goal_sales_pct: 83 },
                  { name: 'Lucía Rojas', sales_total: 980.0, sales_count: 14, visits: 17, goal_sales_pct: 82 },
                ],
              },
              notes: [],
            },
            error: null,
          }
        }
        if (tool === 'contabilidad_estado') {
          const now = new Date()
          return {
            data: {
              ok: true,
              tool: 'contabilidad_estado',
              nature: 'confirmado',
              generated_at: nowIso(),
              duration_ms: 3,
              data: {
                active: true,
                period: { year: now.getFullYear(), month: now.getMonth() + 1, closed: false },
                reconcile_diffs: [],
                close_issues: [],
              },
              notes: [],
            },
            error: null,
          }
        }
        return { data: { ok: false, status: 'error', error: 'Consulta no disponible.' }, error: null }
      }
      case 'cuentas_por_pagar': {
        const todayStr = new Date().toLocaleDateString('sv-SE')
        const pendingPurchases = getTable('purchases').filter(
          p => p.status !== 'anulada' && p.payment_method === 'credito' && Number(p.balance ?? p.total) > 0
        )
        const bySup = new Map<string, Row>()
        let totalOwed = 0
        let totalOverdue = 0
        for (const p of pendingPurchases) {
          const amt = Number(p.balance ?? p.total) || 0
          if (amt <= 0) continue
          const isOver = Boolean(p.due_date && p.due_date < todayStr)
          totalOwed += amt
          if (isOver) totalOverdue += amt
          const sup = getTable('suppliers').find(s => s.id === p.supplier_id)
          const key = String(p.supplier_id || p.supplier_name || p.id)
          const cur = bySup.get(key) || {
            supplier_id: p.supplier_id || key,
            name: p.supplier_name || sup?.name || 'Proveedor',
            document: sup?.document || null,
            owed: 0,
            overdue: 0,
            oldest_due: null,
            open_purchases: 0,
          }
          cur.owed = Math.round((Number(cur.owed) + amt) * 100) / 100
          if (isOver) cur.overdue = Math.round((Number(cur.overdue) + amt) * 100) / 100
          cur.open_purchases = Number(cur.open_purchases) + 1
          if (p.due_date && (!cur.oldest_due || p.due_date < cur.oldest_due)) cur.oldest_due = p.due_date
          bySup.set(key, cur)
        }
        return {
          data: {
            total_owed: Math.round(totalOwed * 100) / 100,
            total_overdue: Math.round(totalOverdue * 100) / 100,
            suppliers: Array.from(bySup.values()),
          },
          error: null,
        }
      }
      case 'register_warehouse_movement': {
        const whId = String(args.p_warehouse_id || '')
        const prodId = String(args.p_product_id || '')
        const mType = String(args.p_movement_type || '') as 'entry' | 'exit' | 'adjustment'
        const qty = Number(args.p_quantity) || 0
        const wh = getTable('warehouses').find(w => w.id === whId && w.active !== false)
        if (!wh) return { data: null, error: { message: 'La bodega seleccionada no existe o está inactiva' } }
        if (!['entry', 'exit', 'adjustment'].includes(mType) || qty === 0) {
          return { data: null, error: { message: 'Movimiento o cantidad no válida' } }
        }
        const wsTable = getTable('warehouse_stock')
        let ws = wsTable.find(r => r.warehouse_id === whId && r.product_id === prodId)
        if (!ws) {
          ws = { company_id: DEMO_COMPANY_ID, warehouse_id: whId, product_id: prodId, quantity: 0, reserved_quantity: 0, updated_at: nowIso() }
          wsTable.push(ws)
        }
        const before = Number(ws.quantity) || 0
        const reserved = Number(ws.reserved_quantity) || 0
        const delta = mType === 'entry' ? Math.abs(qty) : mType === 'exit' ? -Math.abs(qty) : qty
        const after = Math.round((before + delta) * 1000) / 1000
        if (mType === 'exit' && before - reserved < Math.abs(qty)) {
          return { data: null, error: { message: `Stock disponible insuficiente en bodega (disponible: ${before - reserved})` } }
        }
        if (after < reserved || after < 0) {
          return { data: null, error: { message: 'La operación dejaría existencias negativas o por debajo de lo reservado' } }
        }
        ws.quantity = after
        ws.updated_at = nowIso()
        // Mantener sincronizado el stock consolidado del producto cuando no viene de traslado interno
        if (args.p_reference_type !== 'inventory_transfer') {
          const prod = prods.find(p => p.id === prodId)
          if (prod) {
            const totalWh = wsTable
              .filter(r => r.product_id === prodId)
              .reduce((acc, r) => acc + (Number(r.quantity) || 0), 0)
            prod.stock = Math.max(0, Math.round(totalWh * 1000) / 1000)
          }
        }
        const movId = genId()
        getTable('warehouse_movements').unshift({
          id: movId,
          company_id: DEMO_COMPANY_ID,
          warehouse_id: whId,
          product_id: prodId,
          movement_type: mType,
          quantity_delta: delta,
          quantity_before: before,
          quantity_after: after,
          reference_type: args.p_reference_type || 'manual',
          reference_id: args.p_reference_id || null,
          notes: args.p_notes || null,
          created_by: currentSession?.user?.id || 'demo-dueno-1',
          created_at: nowIso(),
        })
        return { data: movId, error: null }
      }
      case 'process_inventory_transfer': {
        const tId = String(args.p_transfer_id || '')
        const action = String(args.p_action || '')
        const trf = getTable('inventory_transfers').find(t => t.id === tId)
        if (!trf) return { data: null, error: { message: 'Traslado no encontrado' } }
        const items = getTable('inventory_transfer_items').filter(i => i.transfer_id === tId)
        if (items.length === 0) return { data: null, error: { message: 'El traslado no contiene productos' } }
        if (action === 'dispatch') {
          if (trf.status !== 'draft') return { data: null, error: { message: 'Solo se pueden despachar traslados en borrador' } }
          for (const it of items) {
            const res = await handleRpc('register_warehouse_movement', {
              p_warehouse_id: trf.source_warehouse_id,
              p_product_id: it.product_id,
              p_movement_type: 'exit',
              p_quantity: Number(it.quantity),
              p_reference_type: 'inventory_transfer',
              p_reference_id: tId,
              p_notes: 'Despacho de traslado entre bodegas',
            })
            if (res.error) return res
          }
          trf.status = 'in_transit'
          trf.approved_by = currentSession?.user?.id || 'demo-dueno-1'
          trf.approved_at = nowIso()
          trf.updated_at = nowIso()
          return { data: 'Traslado despachado correctamente', error: null }
        }
        return { data: null, error: { message: 'Utiliza la recepción detallada para confirmar ingreso en destino' } }
      }
      case 'receive_inventory_transfer': {
        const tId = String(args.p_transfer_id || '')
        const trf = getTable('inventory_transfers').find(t => t.id === tId)
        if (!trf) return { data: null, error: { message: 'Traslado no encontrado' } }
        if (trf.status !== 'in_transit') return { data: null, error: { message: 'El traslado no está en tránsito' } }
        const incoming = Array.isArray(args.p_items) ? args.p_items : []
        const existing = getTable('inventory_transfer_items').filter(i => i.transfer_id === tId)
        if (incoming.length !== existing.length) {
          return { data: null, error: { message: 'Debes informar todos los productos del traslado' } }
        }
        for (const inc of incoming) {
          const row = existing.find(e => e.product_id === inc.product_id)
          if (!row) return { data: null, error: { message: 'Producto no pertenece al traslado' } }
          const rec = Number(inc.received_quantity) || 0
          const dmg = Number(inc.damaged_quantity) || 0
          const mis = Number(inc.missing_quantity) || 0
          if (rec < 0 || dmg < 0 || mis < 0 || Math.abs(rec + dmg + mis - Number(row.quantity)) > 0.001) {
            return { data: null, error: { message: 'La suma de recibido, dañado y faltante debe coincidir con lo despachado' } }
          }
          row.received_quantity = rec
          row.damaged_quantity = dmg
          row.missing_quantity = mis
          row.receipt_notes = inc.notes || null
          if (rec > 0) {
            await handleRpc('register_warehouse_movement', {
              p_warehouse_id: trf.destination_warehouse_id,
              p_product_id: row.product_id,
              p_movement_type: 'entry',
              p_quantity: rec,
              p_reference_type: 'inventory_transfer',
              p_reference_id: tId,
              p_notes: inc.notes || 'Recepción de traslado en destino',
            })
          }
          // Si hubo merma/faltante en tránsito, ajustar el consolidado de productos
          if (dmg + mis > 0) {
            const prod = prods.find(p => p.id === row.product_id)
            if (prod) prod.stock = Math.max(0, (Number(prod.stock) || 0) - (dmg + mis))
          }
        }
        trf.status = 'received'
        trf.received_by = currentSession?.user?.id || 'demo-dueno-1'
        trf.received_at = nowIso()
        trf.updated_at = nowIso()
        return { data: 'Recepción registrada correctamente', error: null }
      }
      case 'reserve_warehouse_stock': {
        const whId = String(args.p_warehouse_id || '')
        const prodId = String(args.p_product_id || '')
        const qty = Number(args.p_quantity) || 0
        if (qty <= 0) return { data: null, error: { message: 'La cantidad a reservar debe ser mayor que cero' } }
        const wsTable = getTable('warehouse_stock')
        const ws = wsTable.find(r => r.warehouse_id === whId && r.product_id === prodId)
        const avail = (Number(ws?.quantity) || 0) - (Number(ws?.reserved_quantity) || 0)
        if (!ws || avail < qty) {
          return { data: null, error: { message: `Stock disponible insuficiente para reservar (disponible: ${Math.max(0, avail)})` } }
        }
        ws.reserved_quantity = (Number(ws.reserved_quantity) || 0) + qty
        ws.updated_at = nowIso()
        const resId = genId()
        getTable('warehouse_stock_reservations').unshift({
          id: resId,
          company_id: DEMO_COMPANY_ID,
          warehouse_id: whId,
          product_id: prodId,
          quantity: qty,
          status: 'active',
          reference_type: args.p_reference_type || 'reserva_manual',
          reference_id: args.p_reference_id || null,
          expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
          created_at: nowIso(),
        })
        return { data: resId, error: null }
      }
      case 'release_warehouse_reservation': {
        const rId = String(args.p_reservation_id || '')
        const resv = getTable('warehouse_stock_reservations').find(r => r.id === rId)
        if (!resv) return { data: null, error: { message: 'Reserva no encontrada' } }
        if (resv.status !== 'active') return { data: 'La reserva ya fue procesada', error: null }
        const ws = getTable('warehouse_stock').find(w => w.warehouse_id === resv.warehouse_id && w.product_id === resv.product_id)
        if (ws) {
          ws.reserved_quantity = Math.max(0, (Number(ws.reserved_quantity) || 0) - (Number(resv.quantity) || 0))
          ws.updated_at = nowIso()
        }
        resv.status = 'released'
        return { data: 'Reserva liberada correctamente', error: null }
      }
      case 'consume_warehouse_reservation': {
        const rId = String(args.p_reservation_id || '')
        const resv = getTable('warehouse_stock_reservations').find(r => r.id === rId)
        if (!resv || resv.status !== 'active') return { data: null, error: { message: 'La reserva no está activa' } }
        const ws = getTable('warehouse_stock').find(w => w.warehouse_id === resv.warehouse_id && w.product_id === resv.product_id)
        if (!ws) return { data: null, error: { message: 'Existencia no encontrada' } }
        const qty = Number(resv.quantity) || 0
        const before = Number(ws.quantity) || 0
        ws.reserved_quantity = Math.max(0, (Number(ws.reserved_quantity) || 0) - qty)
        ws.quantity = Math.max(0, before - qty)
        ws.updated_at = nowIso()
        const prod = prods.find(p => p.id === resv.product_id)
        if (prod) prod.stock = Math.max(0, (Number(prod.stock) || 0) - qty)
        resv.status = 'consumed'
        const movId = genId()
        getTable('warehouse_movements').unshift({
          id: movId,
          company_id: DEMO_COMPANY_ID,
          warehouse_id: resv.warehouse_id,
          product_id: resv.product_id,
          movement_type: 'exit',
          quantity_delta: -qty,
          quantity_before: before,
          quantity_after: ws.quantity,
          reference_type: resv.reference_type || 'reservation',
          reference_id: resv.id,
          notes: 'Consumo confirmado de reserva de inventario',
          created_by: currentSession?.user?.id || 'demo-dueno-1',
          created_at: nowIso(),
        })
        return { data: movId, error: null }
      }
      case 'registrar_venta_bodega': {
        const whId = String(args.p_warehouse_id || '')
        const wh = getTable('warehouses').find(w => w.id === whId && w.active !== false)
        if (!wh) return { data: null, error: { message: 'La bodega seleccionada no existe o está inactiva' } }
        const items = Array.isArray(args.p_items) ? args.p_items : []
        const wsTable = getTable('warehouse_stock')
        for (const it of items) {
          const ws = wsTable.find(w => w.warehouse_id === whId && w.product_id === it.product_id)
          const avail = (Number(ws?.quantity) || 0) - (Number(ws?.reserved_quantity) || 0)
          if (ws && avail < (Number(it.quantity) || 0)) {
            return { data: null, error: { message: `Stock insuficiente en ${wh.name} (disponible: ${avail})` } }
          }
        }
        const saleRes = await handleRpc('registrar_venta', args)
        if (saleRes.error) return saleRes
        const saleId = (saleRes.data as Row)?.id || genId()
        const saleRow = sales.find(s => s.id === saleId)
        if (saleRow) saleRow.warehouse_id = whId
        for (const it of items) {
          let ws = wsTable.find(w => w.warehouse_id === whId && w.product_id === it.product_id)
          if (!ws) {
            ws = { company_id: DEMO_COMPANY_ID, warehouse_id: whId, product_id: it.product_id, quantity: 0, reserved_quantity: 0, updated_at: nowIso() }
            wsTable.push(ws)
          }
          const before = Number(ws.quantity) || 0
          const q = Number(it.quantity) || 0
          ws.quantity = Math.max(0, before - q)
          ws.updated_at = nowIso()
          getTable('warehouse_movements').unshift({
            id: genId(),
            company_id: DEMO_COMPANY_ID,
            warehouse_id: whId,
            product_id: it.product_id,
            movement_type: 'exit',
            quantity_delta: -q,
            quantity_before: before,
            quantity_after: ws.quantity,
            reference_type: 'sale',
            reference_id: saleId,
            notes: `Salida por venta (${wh.code || wh.name})`,
            created_by: currentSession?.user?.id || 'demo-dueno-1',
            created_at: nowIso(),
          })
        }
        return { data: saleId, error: null }
      }
      case 'asignar_centro_costo_operacion': {
        const tbl = String(args.p_table || '')
        const id = String(args.p_id || '')
        const brId = args.p_branch_id ? String(args.p_branch_id) : null
        if (!['expenses', 'purchases', 'sales', 'acc_entries'].includes(tbl)) {
          return { data: null, error: { message: 'Tabla no soportada' } }
        }
        const row = getTable(tbl).find(r => r.id === id)
        if (!row) return { data: null, error: { message: 'Registro no encontrado' } }
        row.branch_id = brId
        return { data: null, error: null }
      }
      case 'upsert_financial_budget': {
        const budgets = getTable('financial_budgets')
        const bId = args.p_id ? String(args.p_id) : null
        const periodMonth = String(args.p_period_month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`).slice(0, 7) + '-01'
        const branchId = args.p_branch_id ? String(args.p_branch_id) : null
        const kind = String(args.p_kind || 'gasto_operativo')
        const categoryName = String(args.p_category_name || '').trim()
        const amount = Math.max(0, Math.round((Number(args.p_budget_amount) || 0) * 100) / 100)
        const notes = args.p_notes ? String(args.p_notes).trim() : null
        if (!categoryName) return { data: null, error: { message: 'Indica el rubro del presupuesto' } }
        if (bId) {
          const existing = budgets.find(x => x.id === bId)
          if (existing) {
            existing.period_month = periodMonth
            existing.branch_id = branchId
            existing.kind = kind
            existing.category_name = categoryName
            existing.budget_amount = amount
            existing.notes = notes
            existing.updated_at = nowIso()
            return { data: bId, error: null }
          }
        }
        const newId = genId()
        budgets.unshift({
          id: newId,
          company_id: DEMO_COMPANY_ID,
          period_month: periodMonth,
          branch_id: branchId,
          kind,
          category_name: categoryName,
          budget_amount: amount,
          notes,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        return { data: newId, error: null }
      }
      case 'delete_financial_budget': {
        const bId = String(args.p_id || '')
        const budgets = getTable('financial_budgets')
        const idx = budgets.findIndex(x => x.id === bId)
        if (idx >= 0) budgets.splice(idx, 1)
        return { data: null, error: null }
      }
      case 'clonar_presupuesto_mes': {
        const budgets = getTable('financial_budgets')
        const srcMonth = String(args.p_source_month || '').slice(0, 7) + '-01'
        const dstMonth = String(args.p_target_month || '').slice(0, 7) + '-01'
        const pct = Number(args.p_variation_pct) || 0
        const overwrite = Boolean(args.p_overwrite)
        if (srcMonth === dstMonth) {
          return { data: null, error: { message: 'El mes origen y el mes destino deben ser distintos' } }
        }
        const srcRows = budgets.filter(b => String(b.period_month).slice(0, 10) === srcMonth)
        if (overwrite) {
          for (let i = budgets.length - 1; i >= 0; i--) {
            if (String(budgets[i].period_month).slice(0, 10) === dstMonth) budgets.splice(i, 1)
          }
        }
        const factor = Math.max(0, 1 + pct / 100)
        let copied = 0
        for (const r of srcRows) {
          const exists = budgets.some(
            ex =>
              String(ex.period_month).slice(0, 10) === dstMonth &&
              (ex.branch_id || null) === (r.branch_id || null) &&
              ex.kind === r.kind &&
              String(ex.category_name).trim().toLowerCase() === String(r.category_name).trim().toLowerCase()
          )
          if (exists) continue
          budgets.unshift({
            id: genId(),
            company_id: DEMO_COMPANY_ID,
            period_month: dstMonth,
            branch_id: r.branch_id || null,
            kind: r.kind,
            category_name: r.category_name,
            budget_amount: Math.round(Math.max(0, Number(r.budget_amount || 0) * factor) * 100) / 100,
            notes: pct !== 0 ? `Clonado de ${srcMonth.slice(0, 7)} (${pct > 0 ? '+' : ''}${pct}%)` : `Clonado de ${srcMonth.slice(0, 7)}`,
            created_at: nowIso(),
            updated_at: nowIso(),
          })
          copied++
        }
        return { data: { copied, source_month: srcMonth, target_month: dstMonth, variation_pct: pct }, error: null }
      }
      case 'actualizar_imagen_producto': {
        const prod = prods.find(p => p.id === args.p_product_id)
        if (!prod) return { data: null, error: { message: 'Producto no encontrado' } }
        const cleanUrl = args.p_image_url && String(args.p_image_url).trim() ? String(args.p_image_url).trim() : null
        syncDemoProductImageState(String(prod.id), cleanUrl)
        return { data: { ok: true, product_id: prod.id, image_url: cleanUrl }, error: null }
      }
      case 'crear_orden_compra': {
        const items = Array.isArray(args.p_items) ? args.p_items : []
        if (items.length === 0) return { data: null, error: { message: 'Agrega al menos un producto a la orden de compra' } }
        const supId = args.p_supplier_id ? String(args.p_supplier_id) : null
        const sup = supId ? getTable('suppliers').find(s => s.id === supId) : null
        const pos = getTable('purchase_orders')
        const poItems = getTable('purchase_order_items')
        const nextNum = 42 + pos.length
        const poId = genId()
        let total = 0
        for (const it of items) {
          const q = Number(it.ordered_qty ?? it.quantity) || 0
          const c = Number(it.unit_cost ?? it.cost) || 0
          total += Math.round(q * c * 100) / 100
        }
        const actorName = currentSession?.user?.user_metadata?.full_name || currentSession?.user?.email || 'Usuario Demo'
        const autoApprove = Boolean(args.p_auto_approve)
        pos.unshift({
          id: poId,
          company_id: DEMO_COMPANY_ID,
          po_number: `OC-${String(nextNum).padStart(4, '0')}`,
          supplier_id: supId,
          supplier_name: sup?.name || 'Proveedor general',
          branch_id: args.p_branch_id ? String(args.p_branch_id) : null,
          target_warehouse_id: args.p_target_warehouse_id ? String(args.p_target_warehouse_id) : null,
          status: autoApprove ? 'approved' : 'draft',
          payment_terms: String(args.p_payment_terms || 'credito'),
          credit_days: Number(args.p_credit_days) || 30,
          expected_date: args.p_expected_date ? String(args.p_expected_date) : null,
          subtotal: Math.round(total * 100) / 100,
          total: Math.round(total * 100) / 100,
          notes: args.p_notes ? String(args.p_notes).trim() : null,
          linked_purchase_id: null,
          created_by_name: actorName,
          approved_by_name: autoApprove ? actorName : null,
          approved_at: autoApprove ? nowIso() : null,
          received_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        })
        for (const it of items) {
          const prod = prods.find(p => p.id === it.product_id)
          poItems.push({
            id: genId(),
            company_id: DEMO_COMPANY_ID,
            po_id: poId,
            product_id: it.product_id,
            product_name: prod?.name || it.product_name || 'Producto',
            sku: prod?.sku || it.sku || null,
            ordered_qty: Number(it.ordered_qty ?? it.quantity) || 1,
            received_qty: 0,
            rejected_qty: 0,
            unit_cost: Number(it.unit_cost ?? it.cost) || 0,
          })
        }
        return { data: poId, error: null }
      }
      case 'cambiar_estado_orden_compra': {
        const poId = String(args.p_po_id || '')
        const status = String(args.p_status || '')
        const po = getTable('purchase_orders').find(p => p.id === poId)
        if (!po) return { data: null, error: { message: 'Orden de compra no encontrada' } }
        if (po.status === 'received' || po.status === 'cancelled') {
          return { data: null, error: { message: 'No se puede modificar una orden cerrada o cancelada' } }
        }
        po.status = status
        if (status === 'approved') {
          po.approved_by_name = currentSession?.user?.user_metadata?.full_name || 'Dirección'
          po.approved_at = nowIso()
        }
        po.updated_at = nowIso()
        return { data: null, error: null }
      }
      case 'recibir_orden_compra': {
        const poId = String(args.p_po_id || '')
        const po = getTable('purchase_orders').find(p => p.id === poId)
        if (!po) return { data: null, error: { message: 'Orden de compra no encontrada' } }
        if (po.status === 'received' || po.status === 'cancelled') {
          return { data: null, error: { message: 'Esta orden ya fue recibida o cancelada' } }
        }
        const whId = args.p_warehouse_id ? String(args.p_warehouse_id) : (po.target_warehouse_id ? String(po.target_warehouse_id) : null)
        const lines = Array.isArray(args.p_lines) ? args.p_lines : []
        const poItems = getTable('purchase_order_items').filter(i => i.po_id === poId)
        const purchaseItems: Row[] = []

        for (const ln of lines) {
          const item = poItems.find(i => i.id === ln.item_id)
          if (!item) continue
          const recNow = Math.max(0, Number(ln.received_now) || 0)
          const rejNow = Math.max(0, Number(ln.rejected_now) || 0)
          const uCost = Math.max(0, Number(ln.unit_cost ?? item.unit_cost) || 0)
          item.received_qty = (Number(item.received_qty) || 0) + recNow
          item.rejected_qty = (Number(item.rejected_qty) || 0) + rejNow
          item.unit_cost = uCost
          if (ln.lot_code) item.lot_code = String(ln.lot_code)
          if (ln.expiry_date) item.expiry_date = String(ln.expiry_date)
          if (recNow > 0) {
            purchaseItems.push({
              product_id: item.product_id,
              product_name: item.product_name,
              quantity: recNow,
              cost: uCost,
              subtotal: Math.round(recNow * uCost * 100) / 100,
              ...(ln.expiry_date ? { lot_code: ln.lot_code || '', expiry_date: ln.expiry_date } : {}),
            })
          }
        }

        if (purchaseItems.length === 0) {
          return { data: null, error: { message: 'Indica al menos una unidad recibida conforme' } }
        }

        const method = String(args.p_payment_method || po.payment_terms || 'credito')
        const creditDays = Number(args.p_credit_days ?? po.credit_days ?? 30)
        const purRes = await handleRpc('registrar_compra', {
          p_supplier_id: po.supplier_id,
          p_items: purchaseItems,
          p_payment_method: method,
          p_credit_days: creditDays,
        })
        if (purRes.error) return purRes

        const purId = (purRes.data as Row)?.id || getTable('purchases')[0]?.id || genId()
        const purRow = getTable('purchases').find(p => p.id === purId)
        if (purRow) {
          purRow.branch_id = po.branch_id || null
          purRow.warehouse_id = whId
        }

        if (whId) {
          const wsTable = getTable('warehouse_stock')
          for (const pit of purchaseItems) {
            let ws = wsTable.find(w => w.warehouse_id === whId && w.product_id === pit.product_id)
            if (!ws) {
              ws = { company_id: DEMO_COMPANY_ID, warehouse_id: whId, product_id: pit.product_id, quantity: 0, reserved_quantity: 0, updated_at: nowIso() }
              wsTable.push(ws)
            }
            const before = Number(ws.quantity) || 0
            const q = Number(pit.quantity) || 0
            ws.quantity = before + q
            ws.updated_at = nowIso()
            getTable('warehouse_movements').unshift({
              id: genId(),
              company_id: DEMO_COMPANY_ID,
              warehouse_id: whId,
              product_id: pit.product_id,
              movement_type: 'entry',
              quantity_delta: q,
              quantity_before: before,
              quantity_after: ws.quantity,
              reference_type: 'purchase_order',
              reference_id: poId,
              notes: `Recepción auditada ${po.po_number}`,
              created_by: currentSession?.user?.id || 'demo-almacen-1',
              created_at: nowIso(),
            })
          }
        }

        const allDone = poItems.every(i => (Number(i.received_qty) || 0) + (Number(i.rejected_qty) || 0) >= (Number(i.ordered_qty) || 0))
        po.status = allDone ? 'received' : 'partial'
        if (whId) po.target_warehouse_id = whId
        po.linked_purchase_id = purId
        po.received_at = nowIso()
        po.updated_at = nowIso()
        return { data: purId, error: null }
      }
      case 'admin_diagnostico_esquema': {
        return {
          data: {
            ok: true,
            checked_at: nowIso(),
            pg_version: '15.8 (Entorno Demo en Memoria)',
            tables: [
              { name: 'profiles', label: 'Perfiles y roles de usuario', installed: true },
              { name: 'member_profiles', label: 'Expedientes de personal y nómina', installed: true },
              { name: 'branches', label: 'Sucursales y centros de costo', installed: true },
              { name: 'warehouses', label: 'Bodegas multibodega', installed: true },
              { name: 'purchase_orders', label: 'Órdenes de compra y recepción', installed: true },
              { name: 'financial_budgets', label: 'Presupuesto maestro financiero', installed: true },
              { name: 'product_images', label: 'Imágenes reales POS y catálogo PDF', installed: true },
              { name: 'catalog_orders', label: 'Pedidos web de catálogo y captures de pago', installed: true },
              { name: 'support_tickets', label: 'Soporte técnico y sesiones autorizadas', installed: true },
              { name: 'cpa_working_papers', label: 'Papeles de trabajo y firma CPC', installed: true },
              { name: 'acc_accounts', label: 'Plan de cuentas contables', installed: true },
              { name: 'acc_entries', label: 'Libro diario y comprobantes', installed: true },
              { name: 'platform_staff', label: 'Equipo interno de plataforma', installed: true },
              { name: 'platform_admin_audit', label: 'Auditoría comercial del plano global', installed: true },
              { name: 'sql_migration_log', label: 'Bitácora de migraciones SQL', installed: true },
            ],
            rpcs: [
              { name: 'is_tech_support', label: 'Validador RLS de soporte técnico', installed: true },
              { name: 'admin_guardar_usuario_completo', label: 'Gestión integral de roles (11 perfiles)', installed: true },
              { name: 'admin_listar_empresas_comerciales', label: 'Listado comercial multiempresa', installed: true },
              { name: 'admin_activar_plan_empresa', label: 'Activación de planes por empresa', installed: true },
              { name: 'admin_reactivar_prueba_empresa', label: 'Concesión de pruebas gratuitas por empresa', installed: true },
              { name: 'admin_cambiar_estado_empresa', label: 'Suspensión y reactivación comercial de empresas', installed: true },
              { name: 'admin_listar_equipo_plataforma', label: 'Listado del equipo global de plataforma', installed: true },
              { name: 'admin_asignar_personal_plataforma', label: 'Asignación de cargos y permisos de plataforma', installed: true },
              { name: 'admin_estado_personal_plataforma', label: 'Activación/suspensión de integrantes globales', installed: true },
              { name: 'admin_listar_auditoria_plataforma', label: 'Bitácora de auditoría del administrador central', installed: true },
              { name: 'support_grant_ticket_authorization', label: 'Concesión auditable de sesión de soporte', installed: true },
              { name: 'support_has_active_authorization', label: 'Verificación de permiso de acceso a soporte', installed: true },
              { name: 'support_register_access', label: 'Registro de auditoría de entrada a soporte', installed: true },
              { name: 'actualizar_imagen_producto', label: 'Sincronización de imágenes POS/Catálogo', installed: true },
              { name: 'obtener_catalogo_publico', label: 'Catálogo público multiempresa', installed: true },
              { name: 'resolver_catalogo_publico', label: 'Resolución de tienda por alias /tienda/... o UUID', installed: true },
              { name: 'obtener_metadatos_enlace_tienda', label: 'Metadatos OpenGraph propios de empresa para WhatsApp', installed: true },
              { name: 'verificar_stock_catalogo_publico', label: 'Verificación de stock en tiempo real en carrito', installed: true },
              { name: 'crear_pedido_catalogo_publico', label: 'Registro público de pedidos con variantes y capture', installed: true },
              { name: 'gestionar_pedido_catalogo', label: 'Verificación de captures y ventas de catálogo', installed: true },
              { name: 'acc_trial_balance', label: 'Motor de Hoja de Trabajo y Balance', installed: true },
              { name: 'acc_reconcile', label: 'Conciliación Operación vs. Libros', installed: true },
              { name: 'admin_ejecutar_migracion_sql', label: 'Ejecución SQL en 1 clic desde la web', installed: true },
            ],
          },
          error: null,
        }
      }
      case 'admin_ejecutar_migracion_sql': {
        const sqlText = String(args?.p_sql || '')
        const scriptId = String(args?.p_script_id || 'manual')
        const scriptTitle = String(args?.p_script_title || 'Script administrativo')
        getTable('sql_migration_log').unshift({
          id: genId(),
          script_id: scriptId,
          script_title: scriptTitle,
          executed_by: currentSession?.user?.id || 'demo-owner-1',
          executed_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          status: 'aplicado',
          summary: 'Simulación completada en entorno de demostración.',
          statements_length: sqlText.length,
          executed_at: nowIso(),
        })
        return {
          data: {
            ok: true,
            executed_at: nowIso(),
            script_id: scriptId,
            message: 'Script validado y registrado en el entorno de demostración.',
          },
          error: null,
        }
      }
      case 'admin_listar_empresas_comerciales': {
        const list = getTable('demo_client_companies')
          .map(c => ({ ...c }))
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        return { data: list, error: null }
      }
      case 'admin_activar_plan_empresa': {
        const companyId = String(args?.p_company_id || '').trim()
        const plan = String(args?.p_plan || '').trim()
        const months = Number(args?.p_months)
        const note = args?.p_note ? String(args.p_note).trim() || null : null
        if (!companyId || companyId === DEMO_COMPANY_ID) {
          return { data: null, error: { message: 'Esta operación solo aplica a empresas clientes' } }
        }
        if (!['emprendedor', 'profesional', 'empresarial', 'corporativo'].includes(plan)) {
          return { data: null, error: { message: 'Plan inválido' } }
        }
        if (!Number.isFinite(months) || months < 0 || months > 120) {
          return { data: null, error: { message: 'La duración debe estar entre 0 y 120 meses' } }
        }
        const co = getTable('demo_client_companies').find(c => c.company_id === companyId)
        if (!co) {
          return { data: null, error: { message: 'No existe suscripción para esta empresa' } }
        }
        const prevPlan = co.plan_type ?? null
        const prevStatus = co.subscription_status ?? null
        const baseMs =
          co.subscription_status === 'active' && co.subscription_end && new Date(co.subscription_end).getTime() > Date.now()
            ? new Date(co.subscription_end).getTime()
            : Date.now()
        const subEnd = months === 0 ? null : new Date(baseMs + months * 30 * 86400000).toISOString()
        co.plan_type = plan
        co.subscription_status = 'active'
        co.subscription_start = prevStatus === 'active' && co.subscription_start ? co.subscription_start : nowIso()
        co.subscription_end = subEnd
        co.trial_start = null
        co.trial_end = null
        getTable('platform_admin_audit').unshift({
          id: genId(),
          actor_id: currentSession?.user?.id || 'demo-owner-1',
          actor_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          target_company_id: companyId,
          target_user_id: null,
          target_email: null,
          event_type: 'company_plan_activated',
          event_data: {
            previous_plan: prevPlan,
            previous_status: prevStatus,
            new_plan: plan,
            months,
            subscription_end: subEnd,
            note,
          },
          created_at: nowIso(),
        })
        return {
          data: {
            ok: true,
            company_id: companyId,
            plan_type: plan,
            subscription_status: 'active',
            subscription_end: subEnd,
          },
          error: null,
        }
      }
      case 'admin_reactivar_prueba_empresa': {
        const companyId = String(args?.p_company_id || '').trim()
        const days = Number(args?.p_days ?? 7)
        if (!companyId || companyId === DEMO_COMPANY_ID) {
          return { data: null, error: { message: 'No puedes modificar la prueba de la empresa interna' } }
        }
        if (!Number.isFinite(days) || days < 1 || days > 90) {
          return { data: null, error: { message: 'La prueba debe durar entre 1 y 90 días' } }
        }
        const co = getTable('demo_client_companies').find(c => c.company_id === companyId)
        if (!co) {
          return { data: null, error: { message: 'No existe suscripción para esta empresa' } }
        }
        const newTrialEnd = new Date(Date.now() + days * 86400000).toISOString()
        co.subscription_status = 'trial'
        co.trial_start = nowIso()
        co.trial_end = newTrialEnd
        co.subscription_start = null
        co.subscription_end = null
        getTable('platform_admin_audit').unshift({
          id: genId(),
          actor_id: currentSession?.user?.id || 'demo-owner-1',
          actor_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          target_company_id: companyId,
          target_user_id: null,
          target_email: null,
          event_type: 'company_trial_granted',
          event_data: { days },
          created_at: nowIso(),
        })
        return {
          data: {
            ok: true,
            company_id: companyId,
            subscription_status: 'trial',
            trial_end: newTrialEnd,
          },
          error: null,
        }
      }
      case 'admin_cambiar_estado_empresa': {
        const companyId = String(args?.p_company_id || '').trim()
        const status = String(args?.p_status || '').trim()
        const note = args?.p_note ? String(args.p_note).trim() || null : null
        if (!companyId || companyId === DEMO_COMPANY_ID) {
          return { data: null, error: { message: 'No puedes cambiar el estado de la empresa interna' } }
        }
        if (!['active', 'suspended', 'expired'].includes(status)) {
          return { data: null, error: { message: 'Estado no permitido' } }
        }
        const co = getTable('demo_client_companies').find(c => c.company_id === companyId)
        if (!co) {
          return { data: null, error: { message: 'No existe suscripción para esta empresa' } }
        }
        const oldStatus = co.subscription_status ?? null
        co.subscription_status = status
        getTable('platform_admin_audit').unshift({
          id: genId(),
          actor_id: currentSession?.user?.id || 'demo-owner-1',
          actor_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          target_company_id: companyId,
          target_user_id: null,
          target_email: null,
          event_type: 'company_subscription_status_changed',
          event_data: {
            previous_status: oldStatus,
            new_status: status,
            note,
          },
          created_at: nowIso(),
        })
        return {
          data: {
            ok: true,
            company_id: companyId,
            subscription_status: status,
          },
          error: null,
        }
      }
      case 'admin_listar_equipo_plataforma': {
        const profilesList = getTable('profiles')
        const staffList = getTable('platform_staff')
          .map(ps => {
            const p = profilesList.find(u => u.id === ps.user_id)
            return {
              user_id: ps.user_id,
              email: p?.email ?? null,
              full_name: p?.full_name ?? null,
              profile_role: p?.role ?? null,
              staff_role: ps.staff_role,
              active: Boolean(ps.active),
              permissions: ps.permissions && typeof ps.permissions === 'object' ? ps.permissions : {},
              notes: ps.notes ?? null,
              granted_by: ps.granted_by,
              granted_at: ps.granted_at,
              updated_at: ps.updated_at,
            }
          })
          .sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1
            const roleCmp = String(a.staff_role).localeCompare(String(b.staff_role))
            if (roleCmp !== 0) return roleCmp
            return String(a.full_name || a.email || '').localeCompare(String(b.full_name || b.email || ''))
          })
        return { data: staffList, error: null }
      }
      case 'admin_asignar_personal_plataforma': {
        const targetUserId = String(args?.p_user_id || '').trim()
        const staffRole = String(args?.p_staff_role || '').trim()
        const permissions =
          args?.p_permissions && typeof args.p_permissions === 'object' && !Array.isArray(args.p_permissions)
            ? args.p_permissions
            : {}
        const notes = args?.p_notes ? String(args.p_notes).trim() || null : null
        const actorId = currentSession?.user?.id || 'demo-owner-1'
        if (!targetUserId || targetUserId === actorId) {
          return { data: null, error: { message: 'Selecciona otro usuario para asignarlo al equipo' } }
        }
        if (
          ![
            'developer',
            'operations_manager',
            'support_manager',
            'technician',
            'commercial',
            'billing',
            'customer_success',
          ].includes(staffRole)
        ) {
          return { data: null, error: { message: 'Cargo de plataforma inválido' } }
        }
        const profile = getTable('profiles').find(p => p.id === targetUserId && p.active !== false)
        if (!profile) {
          return { data: null, error: { message: 'El usuario debe tener una cuenta activa en InventarioPro' } }
        }
        const staffTable = getTable('platform_staff')
        const existing = staffTable.find(s => s.user_id === targetUserId)
        const prevRole = existing?.staff_role ?? null
        const prevActive = existing ? Boolean(existing.active) : null
        const now = nowIso()
        if (existing) {
          existing.staff_role = staffRole
          existing.active = true
          existing.permissions = { ...permissions }
          existing.notes = notes
          existing.granted_by = actorId
          existing.updated_at = now
        } else {
          staffTable.unshift({
            user_id: targetUserId,
            staff_role: staffRole,
            active: true,
            permissions: { ...permissions },
            notes,
            granted_by: actorId,
            granted_at: now,
            updated_at: now,
          })
        }
        getTable('platform_admin_audit').unshift({
          id: genId(),
          actor_id: actorId,
          actor_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          target_company_id: null,
          target_user_id: targetUserId,
          target_email: profile.email || null,
          event_type: 'platform_staff_assigned',
          event_data: {
            previous_role: prevRole,
            previous_active: prevActive,
            new_role: staffRole,
            permissions,
          },
          created_at: now,
        })
        return { data: { ok: true, user_id: targetUserId, staff_role: staffRole }, error: null }
      }
      case 'admin_estado_personal_plataforma': {
        const targetUserId = String(args?.p_user_id || '').trim()
        const nextActive = Boolean(args?.p_active)
        const actorId = currentSession?.user?.id || 'demo-owner-1'
        if (!targetUserId || targetUserId === actorId) {
          return { data: null, error: { message: 'No puedes desactivar tu propia cuenta' } }
        }
        const member = getTable('platform_staff').find(s => s.user_id === targetUserId)
        if (!member) {
          return { data: null, error: { message: 'El integrante no pertenece al equipo de plataforma' } }
        }
        const oldActive = Boolean(member.active)
        member.active = nextActive
        member.updated_at = nowIso()
        const profile = getTable('profiles').find(p => p.id === targetUserId)
        getTable('platform_admin_audit').unshift({
          id: genId(),
          actor_id: actorId,
          actor_email: currentSession?.user?.email || 'sanlobo3@hotmail.com',
          target_company_id: null,
          target_user_id: targetUserId,
          target_email: profile?.email || null,
          event_type: 'platform_staff_status_changed',
          event_data: {
            previous_active: oldActive,
            new_active: nextActive,
          },
          created_at: nowIso(),
        })
        return { data: { ok: true, user_id: targetUserId, active: nextActive }, error: null }
      }
      case 'admin_listar_auditoria_plataforma': {
        const limit = Math.max(1, Math.min(Number(args?.p_limit ?? 100) || 100, 500))
        const profilesList = getTable('profiles')
        const logs = getTable('platform_admin_audit')
          .slice()
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
          .slice(0, limit)
          .map(entry => {
            const actor = profilesList.find(p => p.id === entry.actor_id)
            const target = entry.target_user_id ? profilesList.find(p => p.id === entry.target_user_id) : null
            return {
              ...entry,
              actor_email: entry.actor_email || actor?.email || 'sanlobo3@hotmail.com',
              target_email: entry.target_email || target?.email || null,
            }
          })
        return { data: logs, error: null }
      }
      case 'admin_find_user': {
        const term = String(args?.p_email || '').trim().toLowerCase()
        if (!term) return { data: [], error: null }
        const matches = getTable('profiles')
          .filter(
            p =>
              (p.company_id || DEMO_COMPANY_ID) === DEMO_COMPANY_ID &&
              (String(p.email || '').toLowerCase().includes(term) ||
                String(p.full_name || '').toLowerCase().includes(term))
          )
          .slice(0, 20)
          .map(p => ({ ...p }))
        return { data: matches, error: null }
      }
      case 'admin_list_courtesies': {
        const list = getTable('profiles')
          .filter(
            p =>
              (p.company_id || DEMO_COMPANY_ID) === DEMO_COMPANY_ID &&
              Boolean(p.plan_courtesy) &&
              p.subscription_status === 'active'
          )
          .map(p => ({ ...p }))
        return { data: list, error: null }
      }
      case 'admin_set_plan': {
        const p = getTable('profiles').find(x => x.id === args?.p_user_id)
        if (!p) return { data: null, error: { message: 'Usuario no encontrado' } }
        const isLifetime = Boolean(args?.p_lifetime)
        const days = Math.max(1, Number(args?.p_days) || 30)
        p.plan_type = String(args?.p_plan || 'profesional')
        p.subscription_status = 'active'
        p.subscription_end = isLifetime ? null : new Date(Date.now() + days * 86400000).toISOString()
        p.plan_courtesy = Boolean(args?.p_courtesy)
        p.plan_note = args?.p_note ? String(args.p_note).trim() || null : null
        return { data: { ok: true, user_id: p.id }, error: null }
      }
      case 'admin_revoke_plan': {
        const p = getTable('profiles').find(x => x.id === args?.p_user_id)
        if (!p) return { data: null, error: { message: 'Usuario no encontrado' } }
        p.subscription_status = 'expired'
        p.subscription_end = null
        p.plan_courtesy = false
        p.plan_note = null
        return { data: { ok: true, user_id: p.id }, error: null }
      }
      case 'support_grant_ticket_authorization': {
        const tk = getTable('support_tickets').find(t => t.id === args?.p_ticket_id)
        if (!tk) {
          return { data: { success: false, message: 'Ticket de soporte no encontrado.' }, error: null }
        }
        const hours = Math.min(168, Math.max(1, Number(args?.p_duration_hours) || 24))
        const untilIso = new Date(Date.now() + hours * 3600 * 1000).toISOString()
        const code = tk.authorization_code || `AUT-${Math.floor(1000 + Math.random() * 9000)}-IP`
        tk.session_authorized = true
        tk.authorization_code = code
        tk.authorized_at = nowIso()
        tk.authorized_until = untilIso
        tk.revoked_at = null
        if (args?.p_scope) tk.authorization_scope = String(args.p_scope)
        if (args?.p_module) tk.module_page = String(args.p_module)
        tk.assigned_to = tk.assigned_to || 'demo-tecnico-1'
        tk.assigned_name = tk.assigned_name || 'Ing. Gabriel Soto'
        tk.updated_at = nowIso()
        return {
          data: {
            success: true,
            authorization_code: code,
            authorized_until: untilIso,
            authorization_id: genId(),
            technician_id: tk.assigned_to,
            technician_name: tk.assigned_name,
          },
          error: null,
        }
      }
      case 'support_revoke_ticket_authorization': {
        const tk = getTable('support_tickets').find(t => t.id === args?.p_ticket_id)
        if (!tk) {
          return { data: { success: false, message: 'Ticket de soporte no encontrado.' }, error: null }
        }
        tk.session_authorized = false
        tk.revoked_at = nowIso()
        tk.updated_at = nowIso()
        return { data: { success: true }, error: null }
      }
      case 'support_update_ticket_technical_resolution': {
        const tk = getTable('support_tickets').find(t => t.id === args?.p_ticket_id)
        if (!tk) {
          return { data: { success: false, message: 'Ticket de soporte no encontrado.' }, error: null }
        }
        const nextStatus = String(args?.p_status || tk.status)
        const now = nowIso()
        tk.status = nextStatus
        tk.tech_diagnosis = args?.p_tech_diagnosis ?? null
        tk.resolution_notes = args?.p_resolution_notes ?? null
        tk.assigned_to = currentSession?.user?.id || tk.assigned_to || 'demo-tecnico-1'
        tk.assigned_name = currentSession?.user?.user_metadata?.full_name || tk.assigned_name || 'Ing. Gabriel Soto'
        if (nextStatus === 'resuelto' || nextStatus === 'cerrado') {
          tk.resolved_at = now
        }
        tk.updated_at = now
        return { data: { success: true }, error: null }
      }
      case 'support_has_active_authorization': {
        const tk = getTable('support_tickets').find(t => t.id === args?.p_ticket_id)
        if (!tk || !tk.session_authorized || tk.revoked_at || tk.status === 'resuelto' || tk.status === 'cerrado') {
          return { data: false, error: null }
        }
        const untilMs = tk.authorized_until ? new Date(tk.authorized_until).getTime() : 0
        if (!Number.isFinite(untilMs) || untilMs <= Date.now()) {
          return { data: false, error: null }
        }
        if (args?.p_module && String(args.p_module) !== String(tk.module_page || '')) {
          return { data: false, error: null }
        }
        return { data: true, error: null }
      }
      case 'support_register_access': {
        const tk = getTable('support_tickets').find(t => t.id === args?.p_ticket_id)
        if (!tk) {
          return { data: { success: false, message: 'Ticket no encontrado.' }, error: null }
        }
        tk.updated_at = nowIso()
        return { data: { success: true }, error: null }
      }
      default:
        return { data: null, error: null }
    }
  }

  const mock = {
    from: (table: string) => makeBuilder(table),
    rpc: handleRpc,
    auth: {
      async getSession() {
        return { data: { session: currentSession }, error: null }
      },
      async getUser() {
        return { data: { user: currentSession?.user ?? null }, error: null }
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onAuthStateChange(callback: (event: string, session: any) => void) {
        authListeners.add(callback)
        return {
          data: {
            subscription: {
              unsubscribe() { authListeners.delete(callback) },
            },
          },
        }
      },
      async signInWithPassword({ email }: { email: string; password: string }) {
        const profile = ensureProfile(email)
        const session = {
          access_token: 'mock-jwt-token',
          token_type: 'bearer',
          user: { id: profile.id, email: profile.email, user_metadata: { full_name: profile.full_name } },
        }
        saveSession(session)
        authListeners.forEach(cb => cb('SIGNED_IN', session))
        return { data: { user: session.user, session }, error: null }
      },
      async signUp({ email, options }: { email: string; password: string; options?: { data?: { full_name?: string } } }) {
        const profile = ensureProfile(email, options?.data?.full_name)
        const session = {
          access_token: 'mock-jwt-token',
          token_type: 'bearer',
          user: { id: profile.id, email: profile.email, user_metadata: { full_name: profile.full_name } },
        }
        saveSession(session)
        authListeners.forEach(cb => cb('SIGNED_IN', session))
        return { data: { user: session.user, session }, error: null }
      },
      async resetPasswordForEmail() {
        return { data: {}, error: null }
      },
      async updateUser() {
        return { data: { user: currentSession?.user ?? null }, error: null }
      },
      async signOut() {
        saveSession(null)
        authListeners.forEach(cb => cb('SIGNED_OUT', null))
        return { error: null }
      },
    },
    channel() {
      const ch = {
        on: () => ch,
        subscribe: () => ch,
        unsubscribe: async () => 'ok',
      }
      return ch
    },
    removeChannel: async () => 'ok',
    storage: (() => {
      const memBuckets = new Map<string, Map<string, { url: string; blob: Blob }>>()
      const getBucketMap = (bucket: string) => {
        let b = memBuckets.get(bucket)
        if (!b) {
          b = new Map()
          memBuckets.set(bucket, b)
        }
        return b
      }
      return {
        from(bucket: string) {
          const store = getBucketMap(bucket)
          return {
            async upload(path: string, file: Blob) {
              const url =
                typeof URL !== 'undefined' && file instanceof Blob
                  ? URL.createObjectURL(file)
                  : ''
              store.set(path, { url, blob: file })
              return { data: { path }, error: null }
            },
            getPublicUrl(path: string) {
              return { data: { publicUrl: store.get(path)?.url || path } }
            },
            async createSignedUrl(path: string, _expiresIn: number) {
              return {
                data: { signedUrl: store.get(path)?.url || path },
                error: null,
              }
            },
            async download(path: string) {
              const found = store.get(path)
              if (!found) {
                return { data: null, error: { message: 'Objeto no encontrado en modo demostración' } }
              }
              return { data: found.blob, error: null }
            },
            async remove(paths: string[]) {
              for (const p of paths) store.delete(p)
              return { data: [], error: null }
            },
          }
        },
      }
    })(),
  }

  return mock as unknown as SupabaseClient
}

export type DemoRole =
  | 'dueno'
  | 'admin_empresa'
  | 'contador'
  | 'almacen'
  | 'vendedor'
  | 'transportador'
  | 'tecnico'

const DEMO_MODE_STORAGE_KEY = 'ip_demo_mode'
const DEMO_ROLE_STORAGE_KEY = 'ip_demo_role'

const VALID_DEMO_ROLES: DemoRole[] = [
  'dueno',
  'admin_empresa',
  'contador',
  'almacen',
  'vendedor',
  'transportador',
  'tecnico',
]

function readInitialDemoMode(): boolean {
  try {
    return sessionStorage.getItem(DEMO_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function readInitialDemoRole(): DemoRole {
  try {
    const raw = sessionStorage.getItem(DEMO_ROLE_STORAGE_KEY) as DemoRole | null
    return raw && VALID_DEMO_ROLES.includes(raw) ? raw : 'dueno'
  } catch {
    return 'dueno'
  }
}

const realSupabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null

let demoModeActive: boolean = readInitialDemoMode()
let demoRoleCurrent: DemoRole = readInitialDemoRole()
let mockSupabase: SupabaseClient = createMockSupabase(Boolean(realSupabase))

export function isDemoMode(): boolean {
  return demoModeActive || !realSupabase
}

export function getDemoRole(): DemoRole {
  return demoRoleCurrent
}

export function getDemoUserId(role: DemoRole = demoRoleCurrent): string {
  switch (role) {
    case 'admin_empresa':
      return 'demo-admin-emp-1'
    case 'contador':
      return 'demo-contador-1'
    case 'almacen':
      return 'demo-almacen-1'
    case 'vendedor':
      return 'demo-seller-1'
    case 'transportador':
      return 'demo-transporte-1'
    case 'tecnico':
      return 'demo-tecnico-1'
    default:
      return 'demo-dueno-1'
  }
}

function getDemoEmail(role: DemoRole): string {
  switch (role) {
    case 'admin_empresa':
      return 'operaciones@losandesdemo.com'
    case 'contador':
      return 'contabilidad@losandesdemo.com'
    case 'almacen':
      return 'almacen@losandesdemo.com'
    case 'vendedor':
      return 'carlos.ruta@losandesdemo.com'
    case 'transportador':
      return 'logistica@losandesdemo.com'
    case 'tecnico':
      return 'soporte@inventariopro.demo'
    default:
      return 'gerencia@losandesdemo.com'
  }
}

export async function activateDemoSession(role: DemoRole = 'dueno'): Promise<void> {
  demoModeActive = true
  demoRoleCurrent = role
  try {
    sessionStorage.setItem(DEMO_MODE_STORAGE_KEY, '1')
    sessionStorage.setItem(DEMO_ROLE_STORAGE_KEY, role)
  } catch {
    /* ignore */
  }
  await mockSupabase.auth.signInWithPassword({
    email: getDemoEmail(role),
    password: 'demo',
  })
}

export function deactivateDemoSession(): void {
  demoModeActive = false
  try {
    sessionStorage.removeItem(DEMO_MODE_STORAGE_KEY)
    sessionStorage.removeItem(DEMO_ROLE_STORAGE_KEY)
    sessionStorage.removeItem('ip_mock_auth_session')
  } catch {
    /* ignore */
  }
  void mockSupabase.auth.signOut()
}

export async function resetDemoWorkspace(role: DemoRole = demoRoleCurrent): Promise<void> {
  try {
    sessionStorage.removeItem('ip_mock_auth_session')
    localStorage.removeItem('ip_demo_product_images_v1')
  } catch {
    /* ignore */
  }
  mockSupabase = createMockSupabase(true)
  await activateDemoSession(role)
}

export function getRealSupabase(): SupabaseClient {
  return realSupabase ?? mockSupabase
}

export function hasRealSupabaseConfig(): boolean {
  return Boolean(realSupabase && supabaseUrl && supabaseAnonKey)
}

export function getConfiguredSupabaseHost(): string | null {
  if (!supabaseUrl) return null
  try {
    return new URL(supabaseUrl).hostname
  } catch {
    return supabaseUrl
  }
}

export function getSupabaseSqlEditorUrl(): string {
  const host = getConfiguredSupabaseHost()
  if (host) {
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i)
    if (match && match[1]) {
      return `https://supabase.com/dashboard/project/${match[1]}/sql/new`
    }
  }
  return 'https://supabase.com/dashboard/projects'
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const active = demoModeActive || !realSupabase ? mockSupabase : realSupabase
    const val = Reflect.get(active as object, prop, active)
    return typeof val === 'function' ? val.bind(active) : val
  },
})
