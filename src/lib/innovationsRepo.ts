import { supabase } from './supabase'
import type {
  OmnichannelOrder,
  OmnichannelStage,
  AiActionProposal,
  BranchStockBalanceSuggestion,
  SupplierScorecard,
  AnomalyRecord,
  EpodRecord,
  EquipmentAsset,
  MaintenanceLog,
  EmployeeTargetSummary,
  ComplianceItem,
  ApiKeyRecord,
  WebhookSubscription,
  SupportPassSession,
  DuplicateReceiptWarning,
} from '../types'

const LOCAL_STORAGE_PREFIX = 'ip_innovations_'

function getStorage<T>(key: string, defaultData: T): T {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* ignore */
  }
  return defaultData
}

function setStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

// ============================================================================
// 1. CENTRO UNIVERSAL DE PEDIDOS OMNICANAL
// ============================================================================

const DEFAULT_OMNICHANNEL_ORDERS: OmnichannelOrder[] = [
  {
    id: 'omni-1001',
    company_id: '00000000-0000-4000-8000-000000000001',
    order_number: 'OMNI-1048',
    channel: 'whatsapp',
    stage: 'recibido',
    tracking_pin: '4829',
    customer_type: 'natural',
    customer_id: 'cust-1',
    customer_name: 'Minimarket Los Andes',
    customer_document: '900.123.456-1',
    contact_person: 'Carlos Mendoza',
    requires_fiscal_invoice: true,
    customer_phone: '+57 312 456 7890',
    customer_email: 'losandes@gmail.com',
    delivery_mode: 'delivery',
    delivery_address: 'Carrera 15 #45-20, Local 3, Bucaramanga',
    customer_notes: 'Enviar antes de las 3:00 PM por favor',
    items: [
      {
        product_id: 'prod-cafe',
        product_name: 'Café Gourmet 500g',
        quantity: 12,
        unit_price: 18500,
        subtotal: 222000,
      },
      {
        product_id: 'prod-harina',
        product_name: 'Harina de Maíz 1kg',
        quantity: 24,
        unit_price: 4800,
        subtotal: 115200,
      },
    ],
    subtotal: 337200,
    tax_rate: 0,
    tax_amount: 0,
    total: 337200,
    currency: 'COP',
    payment_method: 'transferencia',
    payment_reference: 'NEQ-94821',
    payment_sender_bank: 'Nequi',
    payment_amount_reported: 337200,
    payment_proof_url: null,
    payment_status: 'verificado',
    order_status: 'nuevo',
    verified_by: 'usr-admin',
    verified_by_name: 'Administrador',
    verified_at: new Date(Date.now() - 3600000).toISOString(),
    admin_notes: 'Cliente preferencial, entrega en ruta Norte.',
    sale_id: null,
    quotation_id: null,
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'omni-1002',
    company_id: '00000000-0000-4000-8000-000000000001',
    order_number: 'OMNI-1049',
    channel: 'catalogo',
    stage: 'alistamiento',
    tracking_pin: '7391',
    customer_type: 'natural',
    customer_id: null,
    customer_name: 'Panadería La Espiga Dorada',
    customer_document: '88.345.120',
    contact_person: 'Doña Martha',
    requires_fiscal_invoice: false,
    customer_phone: '+57 320 987 6543',
    customer_email: 'martha@espiga.com',
    delivery_mode: 'delivery',
    delivery_address: 'Calle 33 #12-18, Barrio San Francisco',
    customer_notes: 'Dejar con el vigilante si no estoy en mostrador',
    items: [
      {
        product_id: 'prod-azucar',
        product_name: 'Azúcar Refinada 1kg',
        quantity: 20,
        unit_price: 5200,
        subtotal: 104000,
      },
      {
        product_id: 'prod-aceite',
        product_name: 'Aceite Vegetal 900ml',
        quantity: 15,
        unit_price: 11900,
        subtotal: 178500,
      },
    ],
    subtotal: 282500,
    tax_rate: 0,
    tax_amount: 0,
    total: 282500,
    currency: 'COP',
    payment_method: 'contraentrega',
    payment_reference: null,
    payment_sender_bank: null,
    payment_amount_reported: null,
    payment_proof_url: null,
    payment_status: 'sin_comprobante',
    order_status: 'alistando',
    verified_by: null,
    verified_by_name: null,
    verified_at: null,
    admin_notes: 'Cobro en efectivo contraentrega.',
    sale_id: null,
    quotation_id: null,
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'omni-1003',
    company_id: '00000000-0000-4000-8000-000000000001',
    order_number: 'OMNI-1050',
    channel: 'ruta',
    stage: 'listo_despacho',
    tracking_pin: '6104',
    customer_type: 'juridica',
    customer_id: 'cust-3',
    customer_name: 'Restaurante El Fogón Boyacense',
    customer_document: '901.888.777-4',
    contact_person: 'Chef Javier',
    requires_fiscal_invoice: true,
    customer_phone: '+57 315 222 3344',
    customer_email: 'compras@elfogon.com',
    delivery_mode: 'delivery',
    delivery_address: 'Av. Las Palmas #56-78',
    customer_notes: 'Factura a nombre de la razón social',
    items: [
      {
        product_id: 'prod-queso',
        product_name: 'Queso Blanco Costeño 500g',
        quantity: 18,
        unit_price: 14000,
        subtotal: 252000,
      },
      {
        product_id: 'prod-arroz',
        product_name: 'Arroz Extra Selección 1kg',
        quantity: 30,
        unit_price: 4900,
        subtotal: 147000,
      },
    ],
    subtotal: 399000,
    tax_rate: 0,
    tax_amount: 0,
    total: 399000,
    currency: 'COP',
    payment_method: 'credito_15d',
    payment_reference: null,
    payment_sender_bank: null,
    payment_amount_reported: null,
    payment_proof_url: null,
    payment_status: 'sin_comprobante',
    order_status: 'alistando',
    verified_by: 'usr-vendedor-1',
    verified_by_name: 'Vendedor Ruta 1',
    verified_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    admin_notes: 'Autorizado a crédito 15 días según cupo disponible.',
    sale_id: null,
    quotation_id: null,
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    updated_at: new Date().toISOString(),
  },
]

export function getOmnichannelOrders(): OmnichannelOrder[] {
  return getStorage<OmnichannelOrder[]>('omnichannel_orders', DEFAULT_OMNICHANNEL_ORDERS)
}

export function updateOmnichannelStage(
  orderId: string,
  newStage: OmnichannelStage,
  extra?: Partial<OmnichannelOrder>
): OmnichannelOrder[] {
  const list = getOmnichannelOrders()
  const updated = list.map(o => {
    if (o.id === orderId) {
      return {
        ...o,
        stage: newStage,
        ...extra,
        updated_at: new Date().toISOString(),
      }
    }
    return o
  })
  setStorage('omnichannel_orders', updated)
  return updated
}

export function createOmnichannelOrder(
  newOrder: Omit<OmnichannelOrder, 'id' | 'order_number' | 'tracking_pin' | 'created_at' | 'updated_at'>
): OmnichannelOrder {
  const list = getOmnichannelOrders()
  const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString()
  const orderNumber = `OMNI-${Date.now().toString().slice(-4)}`
  const pin = Math.floor(1000 + Math.random() * 9000).toString()
  const fullOrder: OmnichannelOrder = {
    ...newOrder,
    id: `omni-${Date.now()}-${randomSuffix}`,
    order_number: orderNumber,
    tracking_pin: pin,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  const updated = [fullOrder, ...list]
  setStorage('omnichannel_orders', updated)
  return fullOrder
}

// ============================================================================
// 2. AGENTE DE IA CON EJECUCIÓN BAJO APROBACIÓN (HUMAN-IN-THE-LOOP)
// ============================================================================

const DEFAULT_AI_PROPOSALS: AiActionProposal[] = [
  {
    id: 'ai-prop-1',
    company_id: '00000000-0000-4000-8000-000000000001',
    action_type: 'crear_orden_compra',
    title: 'Generar Orden de Compra #OC-2026-089 a Lácteos del Norte',
    explanation:
      'El Queso Blanco tiene solo 4 unidades en existencia y la tasa de venta promedio proyecta un agotamiento en 2.3 días. Se sugiere pedir 50 unidades al costo pactado ($10.500 COP c/u, Total $525.000 COP).',
    severity: 'alta',
    required_role: 'dueno',
    payload: {
      supplier_name: 'Lácteos del Norte S.A.S.',
      product_id: 'prod-queso',
      product_name: 'Queso Blanco Costeño 500g',
      quantity: 50,
      unit_cost: 10500,
      total_amount: 525000,
      delivery_expected_days: 2,
    },
    created_at: new Date(Date.now() - 3600000 * 1.5).toISOString(),
    status: 'pendiente',
  },
  {
    id: 'ai-prop-2',
    company_id: '00000000-0000-4000-8000-000000000001',
    action_type: 'ajuste_precio_minimo',
    title: 'Ajuste del Escudo de Precios para Harina de Maíz',
    explanation:
      'El último lote recibido aumentó de costo un 7.5% ($3.200 a $3.440). Para resguardar el margen mínimo del 25%, el precio de venta recomendado debe subir de $4.500 a $4.800 COP.',
    severity: 'media',
    required_role: 'admin_empresa',
    payload: {
      product_id: 'prod-harina',
      product_name: 'Harina de Maíz 1kg',
      old_cost: 3200,
      new_cost: 3440,
      old_price: 4500,
      recommended_price: 4800,
      target_margin_pct: 28.3,
    },
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
    status: 'pendiente',
  },
  {
    id: 'ai-prop-3',
    company_id: '00000000-0000-4000-8000-000000000001',
    action_type: 'recordatorio_cartera',
    title: 'Envío de Aviso Amistoso por WhatsApp a 3 Clientes con Factura Vencida',
    explanation:
      '3 clientes de confianza superaron el plazo de 15 días de crédito por un total acumulado de $840.000 COP. La IA redactó una plantilla respetuosa y lista para aprobación.',
    severity: 'optimizacion',
    required_role: 'vendedor',
    payload: {
      customers: [
        { name: 'Tienda La Esmeralda', days_overdue: 18, debt: 340000 },
        { name: 'Cafetería Central', days_overdue: 16, debt: 280000 },
        { name: 'Frutería San Juan', days_overdue: 15, debt: 220000 },
      ],
      total_debt: 840000,
    },
    created_at: new Date(Date.now() - 3600000 * 6).toISOString(),
    status: 'pendiente',
  },
]

export function getAiActionProposals(): AiActionProposal[] {
  return getStorage<AiActionProposal[]>('ai_proposals', DEFAULT_AI_PROPOSALS)
}

export function approveAiActionProposal(
  proposalId: string,
  approvedByName: string
): AiActionProposal[] {
  const list = getAiActionProposals()
  const updated = list.map(p => {
    if (p.id === proposalId) {
      return {
        ...p,
        status: 'aprobada' as const,
        approved_by: approvedByName,
        approved_at: new Date().toISOString(),
        executed_tx_id: `TX-AI-${Date.now().toString(36).toUpperCase()}`,
      }
    }
    return p
  })
  setStorage('ai_proposals', updated)
  return updated
}

export function rejectAiActionProposal(proposalId: string, reason: string): AiActionProposal[] {
  const list = getAiActionProposals()
  const updated = list.map(p => {
    if (p.id === proposalId) {
      return {
        ...p,
        status: 'rechazada' as const,
        rejection_reason: reason,
      }
    }
    return p
  })
  setStorage('ai_proposals', updated)
  return updated
}

// ============================================================================
// 3. BALANCEO PREDICTIVO ENTRE SUCURSALES
// ============================================================================

const DEFAULT_BRANCH_SUGGESTIONS: BranchStockBalanceSuggestion[] = [
  {
    id: 'bal-1',
    product_id: 'prod-cafe',
    product_name: 'Café Gourmet 500g',
    sku: 'CAF-500',
    source_branch_id: 'b-central',
    source_branch_name: 'Bodega Central de Distribución',
    source_stock: 145,
    source_days_cover: 62,
    target_branch_id: 'b-centro',
    target_branch_name: 'Sucursal Centro (Punto de Venta)',
    target_stock: 4,
    target_days_cover: 2.1,
    suggested_transfer_qty: 35,
    estimated_stockout_days: 2,
    status: 'sugerido',
  },
  {
    id: 'bal-2',
    product_id: 'prod-aceite',
    product_name: 'Aceite Vegetal 900ml',
    sku: 'ACE-900',
    source_branch_id: 'b-norte',
    source_branch_name: 'Bodega Norte',
    source_stock: 82,
    source_days_cover: 48,
    target_branch_id: 'b-centro',
    target_branch_name: 'Sucursal Centro (Punto de Venta)',
    target_stock: 8,
    target_days_cover: 3.5,
    suggested_transfer_qty: 25,
    estimated_stockout_days: 3,
    status: 'sugerido',
  },
  {
    id: 'bal-3',
    product_id: 'prod-arroz',
    product_name: 'Arroz Extra Selección 1kg',
    sku: 'ARR-1K',
    source_branch_id: 'b-central',
    source_branch_name: 'Bodega Central de Distribución',
    source_stock: 310,
    source_days_cover: 55,
    target_branch_id: 'b-sur',
    target_branch_name: 'Sucursal Sur',
    target_stock: 12,
    target_days_cover: 2.8,
    suggested_transfer_qty: 60,
    estimated_stockout_days: 2,
    status: 'sugerido',
  },
]

export function getBranchBalanceSuggestions(): BranchStockBalanceSuggestion[] {
  return getStorage<BranchStockBalanceSuggestion[]>('branch_balance', DEFAULT_BRANCH_SUGGESTIONS)
}

// ============================================================================
// 4. INTELIGENCIA Y EVALUACIÓN DE PROVEEDORES
// ============================================================================

const DEFAULT_SUPPLIER_SCORECARDS: SupplierScorecard[] = [
  {
    supplier_id: 'sup-1',
    supplier_name: 'Distribuidora Lácteos del Norte S.A.S.',
    supplier_document: '900.541.223-8',
    total_orders: 28,
    completed_orders: 28,
    on_time_in_full_pct: 96.4,
    avg_delay_days: 0.3,
    cost_variation_pct_12m: 3.8,
    return_rate_pct: 0.8,
    grade: 'A+',
    active_alerts: ['Proveedor prioritario: cumplimiento intachable en 2026'],
    last_purchase_date: '2026-11-01',
  },
  {
    supplier_id: 'sup-2',
    supplier_name: 'Molinos del Valle Central',
    supplier_document: '890.312.441-2',
    total_orders: 19,
    completed_orders: 18,
    on_time_in_full_pct: 78.9,
    avg_delay_days: 3.2,
    cost_variation_pct_12m: 14.5,
    return_rate_pct: 3.1,
    grade: 'B',
    active_alerts: [
      'Alerta de alza de precios: varió costos unitarios 14.5% en los últimos 4 meses.',
      'Demoras en entrega promedio de 3.2 días.',
    ],
    last_purchase_date: '2026-10-25',
  },
  {
    supplier_id: 'sup-3',
    supplier_name: 'Importadora Andina de Aceites y Granos',
    supplier_document: '901.114.998-5',
    total_orders: 14,
    completed_orders: 13,
    on_time_in_full_pct: 85.7,
    avg_delay_days: 1.5,
    cost_variation_pct_12m: 5.2,
    return_rate_pct: 1.4,
    grade: 'A',
    active_alerts: ['Buen cumplimiento logístico, precios estables en el trimestre.'],
    last_purchase_date: '2026-10-28',
  },
]

export function getSupplierScorecards(): SupplierScorecard[] {
  return getStorage<SupplierScorecard[]>('supplier_scorecards', DEFAULT_SUPPLIER_SCORECARDS)
}

// ============================================================================
// 5. DETECCIÓN DE ANOMALÍAS Y PREVENCIÓN DE PÉRDIDAS
// ============================================================================

const DEFAULT_ANOMALIES: AnomalyRecord[] = [
  {
    id: 'anom-1',
    company_id: '00000000-0000-4000-8000-000000000001',
    category: 'descuento_inusual',
    severity: 'moderada',
    title: 'Descuentos repetidos superiores al 18% en Caja Mostrador #2',
    description:
      'El terminal #2 aplicó 6 descuentos manuales del 20% en un lapso de 90 minutos a clientes sin perfil mayorista registrado.',
    involved_user_name: 'Cajero Turno Tarde',
    involved_branch: 'Sucursal Centro',
    financial_impact: 114000,
    detected_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    status: 'pendiente_revision',
  },
  {
    id: 'anom-2',
    company_id: '00000000-0000-4000-8000-000000000001',
    category: 'merma_ciega',
    severity: 'critica',
    title: 'Discrepancia en Toma Ciega: Café Gourmet (-7 unidades)',
    description:
      'El conteo ciego reportó 28 unidades frente a 35 teóricas en sistema sin merma o rotura justificada previa en Kardex.',
    involved_user_name: 'Auxiliar de Bodega',
    involved_branch: 'Bodega Central',
    financial_impact: 129500,
    detected_at: new Date(Date.now() - 86400000).toISOString(),
    status: 'pendiente_revision',
  },
  {
    id: 'anom-3',
    company_id: '00000000-0000-4000-8000-000000000001',
    category: 'devolucion_sospechosa',
    severity: 'moderada',
    title: 'Devolución de mercancía con salida de efectivo sin ticket físico',
    description:
      'Se registró devolución por $75.000 COP 15 minutos después de cerrar caja del mediodía.',
    involved_user_name: 'Operador Caja 1',
    involved_branch: 'Sucursal Centro',
    financial_impact: 75000,
    detected_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    status: 'justificado',
    reviewed_by: 'Administrador General',
    resolution_notes: 'Cliente regular trajo producto con defecto en empaque; verificado.',
  },
]

export function getAnomalyRecords(): AnomalyRecord[] {
  return getStorage<AnomalyRecord[]>('anomalies', DEFAULT_ANOMALIES)
}

export function resolveAnomalyRecord(
  id: string,
  resolution: 'justificado' | 'sancionado',
  reviewer: string,
  notes: string
): AnomalyRecord[] {
  const list = getAnomalyRecords()
  const updated = list.map(a =>
    a.id === id
      ? {
          ...a,
          status: resolution,
          reviewed_by: reviewer,
          resolution_notes: notes,
        }
      : a
  )
  setStorage('anomalies', updated)
  return updated
}

export function recordAnomaly(
  anomaly: Omit<AnomalyRecord, 'id' | 'detected_at' | 'status'>
): AnomalyRecord {
  const list = getAnomalyRecords()
  const newRecord: AnomalyRecord = {
    ...anomaly,
    id: `anom-${Date.now()}`,
    detected_at: new Date().toISOString(),
    status: 'pendiente_revision',
  }
  const next = [newRecord, ...list]
  setStorage('anomalies', next)
  return newRecord
}

// ============================================================================
// 6. PRUEBA DIGITAL DE ENTREGA (e-POD)
// ============================================================================

export function getEpodRecords(): EpodRecord[] {
  return getStorage<EpodRecord[]>('epod_records', [])
}

export function saveEpodRecord(record: EpodRecord): void {
  const list = getEpodRecords()
  const updated = [record, ...list.filter(r => r.order_id !== record.order_id)]
  setStorage('epod_records', updated)
}

// ============================================================================
// 7. GESTIÓN DE MAQUINARIA, ACTIVOS Y MANTENIMIENTO
// ============================================================================

const DEFAULT_EQUIPMENT_ASSETS: EquipmentAsset[] = [
  {
    id: 'asset-1',
    company_id: '00000000-0000-4000-8000-000000000001',
    asset_code: 'VEH-01',
    name: 'Furgón de Reparto Chevrolet N300',
    category: 'vehiculo',
    serial_number: 'WBA-8839201-COL',
    branch_id: 'b-central',
    branch_name: 'Bodega Central de Distribución',
    purchase_date: '2024-03-15',
    warranty_expires_at: '2027-03-15',
    acquisition_cost: 45000000,
    status: 'operativo',
    maintenance_interval_days: 90,
    last_maintenance_at: '2026-08-10',
    next_maintenance_at: '2026-11-10',
    maintenance_status: 'proximo',
    odometer_or_hours: 48320,
    notes: 'Cambio de aceite, pastillas de freno y alineación.',
  },
  {
    id: 'asset-2',
    company_id: '00000000-0000-4000-8000-000000000001',
    asset_code: 'FRIO-02',
    name: 'Nevera Exhibidora Panorámica 4 Puertas',
    category: 'frio_congelador',
    serial_number: 'IND-COL-44910',
    branch_id: 'b-centro',
    branch_name: 'Sucursal Centro (Punto de Venta)',
    purchase_date: '2023-08-20',
    warranty_expires_at: '2025-08-20',
    acquisition_cost: 9200000,
    status: 'operativo',
    maintenance_interval_days: 120,
    last_maintenance_at: '2026-06-15',
    next_maintenance_at: '2026-10-15',
    maintenance_status: 'vencido',
    notes: 'Limpieza de serpentín y recarga de gas ecológico.',
  },
  {
    id: 'asset-3',
    company_id: '00000000-0000-4000-8000-000000000001',
    asset_code: 'BAL-03',
    name: 'Balanza Electrónica Certificada 30kg',
    category: 'balanza',
    serial_number: 'TOR-REY-30-771',
    branch_id: 'b-centro',
    branch_name: 'Sucursal Centro (Punto de Venta)',
    purchase_date: '2025-01-10',
    warranty_expires_at: '2026-01-10',
    acquisition_cost: 1150000,
    status: 'operativo',
    maintenance_interval_days: 180,
    last_maintenance_at: '2026-07-05',
    next_maintenance_at: '2027-01-05',
    maintenance_status: 'al_dia',
    notes: 'Calibración con pesas patrón certificada por metrología.',
  },
]

export function getEquipmentAssets(): EquipmentAsset[] {
  return getStorage<EquipmentAsset[]>('equipment_assets', DEFAULT_EQUIPMENT_ASSETS)
}

export function saveEquipmentAsset(asset: EquipmentAsset): EquipmentAsset[] {
  const list = getEquipmentAssets()
  const exists = list.some(a => a.id === asset.id)
  const updated = exists ? list.map(a => (a.id === asset.id ? asset : a)) : [asset, ...list]
  setStorage('equipment_assets', updated)
  return updated
}

// ============================================================================
// 8. AUTOSERVICIO DE VENDEDORES
// ============================================================================

export function getEmployeeSelfServiceSummary(): EmployeeTargetSummary {
  return {
    employee_id: 'emp-vendedor-1',
    employee_name: 'Andrés Camilo Rojas',
    current_month_label: 'Noviembre 2026',
    sales_target: 28000000,
    sales_achieved: 21450000,
    sales_progress_pct: 76.6,
    collections_target: 15000000,
    collections_achieved: 12800000,
    earned_commission_total: 1072500,
    paid_commission_total: 640000,
    pending_commission_balance: 432500,
    assigned_customers_count: 42,
    pending_visits_count: 8,
  }
}

// ============================================================================
// 9. ANTI-FRAUDE EN COMPROBANTES DE PAGO
// ============================================================================

export function checkDuplicatePaymentReceipt(
  currentOrderNumber: string,
  reference: string | null | undefined
): DuplicateReceiptWarning | null {
  if (!reference || reference.trim().length < 4) return null
  const cleanRef = reference.trim().toUpperCase()

  // Base histórica de referencias registradas
  const knownReceipts = [
    {
      ref: 'NEQ-884920',
      bank: 'Nequi',
      amount: 185000,
      order: 'FAC-1022',
      customer: 'Supermercado Central',
      date: '2026-10-24',
    },
    {
      ref: 'DAV-449182',
      bank: 'Daviplata',
      amount: 250000,
      order: 'FAC-1035',
      customer: 'Panadería La Unión',
      date: '2026-10-29',
    },
    {
      ref: 'BC-9918201',
      bank: 'Bancolombia',
      amount: 420000,
      order: 'FAC-1040',
      customer: 'Distribuidora San Gil',
      date: '2026-11-02',
    },
  ]

  const match = knownReceipts.find(k => k.ref === cleanRef)
  if (match) {
    return {
      reference: cleanRef,
      sender_bank: match.bank,
      amount: match.amount,
      original_order_number: match.order,
      original_customer_name: match.customer,
      original_date: match.date,
      current_order_number: currentOrderNumber,
    }
  }
  return null
}

// ============================================================================
// 10. CUMPLIMIENTO, VENCIMIENTOS Y CALENDARIO LEGAL
// ============================================================================

const DEFAULT_COMPLIANCE_ITEMS: ComplianceItem[] = [
  {
    id: 'comp-1',
    company_id: '00000000-0000-4000-8000-000000000001',
    title: 'SOAT y Tecnomecánica Furgón Reparto (WBA-883)',
    category: 'transporte_soat',
    due_date: '2026-11-18',
    urgency: 'proximo_vencer',
    days_left: 14,
    estimated_cost: 980000,
    responsible_person: 'Coordinador de Logística',
    notes: 'Evita inmovilización del vehículo de distribución en retén vial.',
  },
  {
    id: 'comp-2',
    company_id: '00000000-0000-4000-8000-000000000001',
    title: 'Declaración Bimestral de IVA (Bimestre 5 Sep-Oct)',
    category: 'impuesto_fiscal',
    due_date: '2026-11-20',
    urgency: 'proximo_vencer',
    days_left: 16,
    estimated_cost: 2450000,
    responsible_person: 'Contador Público Titular',
    notes: 'Presentar formulario 300 ante la administración tributaria.',
  },
  {
    id: 'comp-3',
    company_id: '00000000-0000-4000-8000-000000000001',
    title: 'Certificado de Inspección de Seguridad contra Incendios (Bomberos)',
    category: 'bomberos_sanidad',
    due_date: '2026-12-05',
    urgency: 'vigente',
    days_left: 31,
    estimated_cost: 220000,
    responsible_person: 'Administrador de Sede',
    notes: 'Revisión anual obligatoria de extintores y señalética en bodega.',
  },
  {
    id: 'comp-4',
    company_id: '00000000-0000-4000-8000-000000000001',
    title: 'Renovación Registro Mercantil Cámara de Comercio',
    category: 'camara_comercio',
    due_date: '2027-03-31',
    urgency: 'vigente',
    days_left: 147,
    estimated_cost: 650000,
    responsible_person: 'Representante Legal',
    notes: 'Renovación de matrícula mercantil de persona jurídica y establecimientos.',
  },
]

export function getComplianceItems(): ComplianceItem[] {
  return getStorage<ComplianceItem[]>('compliance_items', DEFAULT_COMPLIANCE_ITEMS)
}

export function saveComplianceItem(item: ComplianceItem): ComplianceItem[] {
  const list = getComplianceItems()
  const exists = list.some(c => c.id === item.id)
  const updated = exists ? list.map(c => (c.id === item.id ? item : c)) : [item, ...list]
  setStorage('compliance_items', updated)
  return updated
}

// ============================================================================
// 11. API Y ECOSISTEMA DE INTEGRACIONES
// ============================================================================

const DEFAULT_API_KEYS: ApiKeyRecord[] = [
  {
    id: 'key-1',
    company_id: '00000000-0000-4000-8000-000000000001',
    key_label: 'Conector Tienda Shopify / WooCommerce',
    api_key_masked: 'ip_live_981a********************3f1a',
    api_key_hash: 'hash-abc-123',
    permissions: ['read_stock', 'create_orders', 'read_products'],
    created_at: '2026-10-10',
    last_used_at: 'Hace 12 minutos',
    is_active: true,
  },
  {
    id: 'key-2',
    company_id: '00000000-0000-4000-8000-000000000001',
    key_label: 'Integración CRM de Ventas Externo',
    api_key_masked: 'ip_live_55bc********************890e',
    api_key_hash: 'hash-def-456',
    permissions: ['read_customers', 'read_products'],
    created_at: '2026-10-22',
    last_used_at: 'Ayer a las 18:40',
    is_active: true,
  },
]

export function getApiKeys(): ApiKeyRecord[] {
  return getStorage<ApiKeyRecord[]>('api_keys', DEFAULT_API_KEYS)
}

export function saveApiKey(key: ApiKeyRecord): ApiKeyRecord[] {
  const list = getApiKeys()
  const updated = [key, ...list]
  setStorage('api_keys', updated)
  return updated
}

// ============================================================================
// 12. PASE DE SOPORTE TÉCNICO TEMPORAL
// ============================================================================

export function getActiveSupportPass(): SupportPassSession | null {
  const pass = getStorage<SupportPassSession | null>('support_pass', null)
  if (!pass) return null
  if (new Date(pass.expires_at).getTime() < Date.now() || !pass.is_active) {
    return null
  }
  return pass
}

export function createSupportPass(
  durationHours: number,
  scopeLevel: SupportPassSession['scope_level'],
  authorizedByName: string,
  authorizedByRole: SupportPassSession['authorized_by_role']
): SupportPassSession {
  const now = Date.now()
  const expiresAt = new Date(now + durationHours * 3600000).toISOString()
  const pass: SupportPassSession = {
    id: `pass-${now.toString(36)}`,
    company_id: '00000000-0000-4000-8000-000000000001',
    company_name: 'Empresa Principal Demo',
    access_code: Math.floor(100000 + Math.random() * 900000).toString(),
    scope_level: scopeLevel,
    authorized_by_name: authorizedByName,
    authorized_by_role: authorizedByRole,
    expires_at: expiresAt,
    is_active: true,
    created_at: new Date().toISOString(),
  }
  setStorage('support_pass', pass)
  return pass
}

export function revokeSupportPass(): void {
  const current = getActiveSupportPass()
  if (current) {
    setStorage('support_pass', {
      ...current,
      is_active: false,
      revoked_at: new Date().toISOString(),
    })
  }
}
