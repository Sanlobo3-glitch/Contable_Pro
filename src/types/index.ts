
export type Role =
  | 'admin'
  | 'super_admin'
  | 'tecnico'
  | 'dueno'
  | 'admin_empresa'
  | 'gerente'
  | 'contador'
  | 'almacen'
  | 'vendedor'
  | 'cajero'
  | 'comprador'
  | 'transportador'

export type SubscriptionStatus =
  | 'trial'
  | 'active'
  | 'expired'
  | 'suspended'
  | 'independent'

export type PlanType =
  | 'emprendedor'
  | 'profesional'
  | 'empresarial'
  | 'corporativo'

export interface ProductVariant {
  id: string
  label: string
  price: number
  price_wholesale?: number | null
  stock_multiplier?: number
  sku_suffix?: string | null
  available?: boolean
}

export interface Product {
  id: string
  name: string
  sku: string
  category_id: string | null
  price: number
  cost: number
  stock: number
  min_stock: number
  unit: string
  price_wholesale?: number | null
  wholesale_min_qty?: number | null
  tracks_expiry?: boolean | null
  image_url?: string | null
  description?: string | null
  featured?: boolean | null
  catalog_visible?: boolean | null
  variant_group_label?: string | null
  variants?: ProductVariant[] | null
  created_at: string
}

export interface Category {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface Customer {
  id: string
  name: string
  document: string | null
  email: string | null
  phone: string | null
  address: string | null
  price_type?: 'detal' | 'mayor' | null
  created_at: string
}

export interface Supplier {
  id: string
  name: string
  document: string | null
  email: string | null
  phone: string | null
  address: string | null
  created_at: string
}

export interface SaleItem {
  product_id: string
  product_name: string
  quantity: number
  price: number
  subtotal: number
}

export interface Sale {
  id: string
  customer_id: string | null
  customer_name: string | null
  items: SaleItem[]
  total: number
  payment_method: string
  status: 'completada' | 'pendiente' | 'anulada'
  channel?: 'ruta' | 'mostrador' | null
  discount_amount?: number | null
  amount_received?: number | null
  fx_currency?: string | null
  fx_amount?: number | null
  fx_rate?: number | null
  warehouse_id?: string | null
  branch_id?: string | null
  created_at: string
}

export interface PurchaseItem {
  product_id: string
  product_name: string
  quantity: number
  cost: number
  subtotal: number
  lot_code?: string | null
  expiry_date?: string | null
  prev_cost?: number | null
}

export interface Purchase {
  id: string
  supplier_id: string | null
  supplier_name: string | null
  items: PurchaseItem[]
  total: number
  status: 'recibida' | 'pendiente' | 'anulada'
  payment_method?: 'efectivo' | 'tarjeta' | 'transferencia' | 'credito' | null
  due_date?: string | null
  credit_days?: number | null
  paid_amount?: number | null
  branch_id?: string | null
  warehouse_id?: string | null
  created_at: string
}

export interface CashEntry {
  id: string
  type: 'ingreso' | 'egreso'
  amount: number
  description: string
  reference_type: string | null
  reference_id: string | null
  created_at: string
}

export interface Devolution {
  id: string
  sale_id: string
  product_id: string
  product_name: string
  quantity: number
  amount: number
  reason: string
  refund_method?: 'efectivo' | 'tarjeta' | 'transferencia' | 'cartera' | null
  created_at: string
}

export interface PurchaseDevolution {
  id: string
  purchase_id: string
  supplier_id: string | null
  supplier_name: string | null
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number
  amount: number
  refund_method: 'efectivo' | 'tarjeta' | 'transferencia' | 'credito'
  reason: string
  status: 'activa' | 'anulada'
  created_by?: string | null
  created_by_name?: string | null
  created_at: string
}

export interface ExpenseCategory {
  id: string
  name: string
  account_id: string | null
  active: boolean
  created_at: string
}

export interface Expense {
  id: string
  category_id: string | null
  category_name: string
  amount: number
  method: 'efectivo' | 'tarjeta' | 'transferencia'
  expense_date: string
  description: string
  beneficiary: string | null
  reference: string | null
  status: 'activo' | 'anulado'
  created_by?: string | null
  created_by_name?: string | null
  branch_id?: string | null
  created_at: string
}

export interface KardexEntry {
  id: string
  product_id: string
  product_name: string
  type: 'entrada' | 'salida'
  quantity: number
  balance: number
  reference_type: string
  reference_id: string | null
  created_at: string
}

export interface QuotationItem {
  product_id: string
  product_name: string
  quantity: number
  price: number
  subtotal: number
}

export interface Quotation {
  id: string
  customer_id: string | null
  customer_name: string | null
  items: QuotationItem[]
  total: number
  status: 'enviada' | 'aceptada' | 'rechazada' | 'vencida'
  valid_until: string
  created_at: string
}

export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: Role
  active: boolean
  created_at: string

  company_id?: string | null
  company_name?: string | null

  trial_start: string | null
  trial_end: string | null
  subscription_status: SubscriptionStatus
  subscription_end: string | null
  paypal_order_id: string | null
  plan_type: PlanType | null

  // Administración global de la plataforma
  platform_admin?: boolean
  subscription_access?: boolean
  unlimited_devices?: boolean

  avatar_url?: string | null
  national_id?: string | null
  phone?: string | null
  job_title?: string | null
  zone?: string | null
  address?: string | null
  emergency_contact?: string | null
  hire_date?: string | null
  base_salary?: number | null
  commission_pct?: number | null
  notes?: string | null
  archived?: boolean | null
}

export interface TeamPayrollMember {
  id: string
  email: string
  full_name: string | null
  role: Role
  active: boolean
  created_at?: string | null
  avatar_url?: string | null
  national_id?: string | null
  phone?: string | null
  job_title?: string | null
  zone?: string | null
  address?: string | null
  emergency_contact?: string | null
  hire_date?: string | null
  base_salary: number
  commission_pct: number
  notes?: string | null
  archived?: boolean
}

export interface CompanySummary {
  company_id: string
  company_name: string
  owner_name: string | null
  owner_email: string | null
  members_count: number
}

export interface Subscription {
  id: string
  user_id: string
  paypal_order_id: string | null
  amount: number
  currency: string
  status: string
  created_at: string
}

export type BrandThemeId =
  | 'emerald'
  | 'slate'
  | 'blue'
  | 'indigo'
  | 'rose'
  | 'amber'
  | 'teal'
  | 'violet'

export type CatalogPaymentMethodKey =
  | 'pago_movil'
  | 'nequi'
  | 'zelle'
  | 'transferencia'
  | 'efectivo_entrega'

export type CatalogDeliveryMode = 'pickup' | 'delivery' | 'shipping'

export interface CatalogPaymentMethodConfig {
  id: CatalogPaymentMethodKey
  enabled: boolean
  label: string
  requires_proof: boolean
  bank_or_platform: string
  account_or_phone: string
  holder_name: string
  holder_document: string
  instructions?: string
}

export type WhatsAppTemplateScenario =
  | 'store_invite'
  | 'catalog_selection'
  | 'wholesale_b2b'
  | 'quick_payment_info'
  | 'order_verified'
  | 'order_dispatched'

export interface CompanyWhatsAppSettings {
  business_whatsapp?: string
  brand_tagline?: string
  og_card_subtitle?: string
  business_hours?: string
  advisor_title?: string
  include_rif_in_messages?: boolean
  include_hours_in_messages?: boolean
  include_payment_summary_in_messages?: boolean
  templates?: Partial<Record<WhatsAppTemplateScenario, string>>
}

export interface CompanyConfig {
  id: string
  company_id?: string
  name: string
  rif: string
  address: string
  phone: string
  email: string
  currency: string
  tax_rate: number
  invoice_prefix: string
  geo_mode?: 'off' | 'vendedores' | 'todos'
  catalog_enabled?: boolean
  catalog_show_wholesale?: boolean
  catalog_show_stock?: boolean
  catalog_welcome?: string | null
  catalog_slug?: string | null
  previous_catalog_slugs?: string[] | null
  brand_version?: string | null
  logo_url?: string | null
  brand_theme?: BrandThemeId | null
  catalog_payment_methods?: CatalogPaymentMethodConfig[] | null
  catalog_delivery_modes?: CatalogDeliveryMode[] | null
  whatsapp_settings?: CompanyWhatsAppSettings | null
  erp_sync_preferences?: ErpSyncEntityPreferences | null
}

export interface ErpSyncEntityPreferences {
  customers: boolean
  products: boolean
  invoices: boolean
  customers_direction?: 'bidirectional' | 'push_to_erp' | 'pull_from_erp'
  products_direction?: 'bidirectional' | 'push_to_erp' | 'pull_from_erp'
  invoices_direction?: 'bidirectional' | 'push_to_erp' | 'pull_from_erp'
  include_suppliers?: boolean
  sync_stock?: boolean
  updated_at?: string
  updated_by?: string
}

export interface PayrollMovement {
  id: string
  user_id: string
  member_name: string
  type: 'adelanto' | 'bono' | 'descuento'
  amount: number
  method: 'efectivo' | 'tarjeta' | 'transferencia' | 'sin_desembolso'
  movement_date: string
  reason: string
  status: 'pendiente' | 'aplicado' | 'anulado'
  expense_id?: string | null
  payment_id?: string | null
  created_by_name?: string | null
  created_at: string
}

export interface PayrollPayment {
  id: string
  user_id: string
  member_name: string
  period_from: string
  period_to: string
  payment_date: string
  base_amount: number
  sales_amount: number
  commission_pct: number
  commission_amount: number
  bonuses_amount: number
  deductions_amount: number
  advances_deducted: number
  net_paid: number
  method: 'efectivo' | 'tarjeta' | 'transferencia'
  reference: string | null
  notes: string | null
  status: 'activo' | 'anulado'
  expense_id?: string | null
  created_by_name?: string | null
  created_at: string
}

export interface RouteDispatchItem {
  id: string
  product_id: string
  product_name: string
  sku: string
  unit: string
  unit_price: number
  qty_loaded: number
  qty_sold: number
  qty_expected_return: number
  qty_returned: number | null
  qty_diff: number | null
}

export interface RouteDispatch {
  id: string
  seller_id: string
  seller_name: string
  dispatch_date: string
  vehicle_label: string | null
  zone: string | null
  opening_cash: number
  status: 'abierto' | 'liquidado' | 'anulado'
  sales_cash: number
  sales_bank: number
  sales_credit: number
  collections_cash: number
  collections_bank: number
  expected_cash: number
  delivered_cash: number | null
  cash_diff: number | null
  notes: string | null
  closed_at: string | null
  closed_by_name: string | null
  created_by_name: string | null
  created_at: string
  items: RouteDispatchItem[]
}

export interface Branch {
  id: string
  company_id?: string
  name: string
  code: string | null
  address: string | null
  phone: string | null
  email: string | null
  is_main: boolean
  active: boolean
  created_at: string
  updated_at?: string
}

export type WarehouseType =
  | 'principal'
  | 'general'
  | 'materia_prima'
  | 'producto_terminado'
  | 'transito'
  | 'devoluciones'

export interface Warehouse {
  id: string
  company_id?: string
  branch_id: string | null
  name: string
  code: string | null
  address: string | null
  warehouse_type: WarehouseType
  active: boolean
  created_at: string
  updated_at?: string
}

export interface WarehouseStockRow {
  company_id?: string
  warehouse_id: string
  product_id: string
  quantity: number
  reserved_quantity: number
  updated_at: string
}

export interface WarehouseMovement {
  id: string
  company_id?: string
  warehouse_id: string
  product_id: string
  movement_type: 'entry' | 'exit' | 'adjustment'
  quantity_delta: number
  quantity_before: number
  quantity_after: number
  reference_type: string | null
  reference_id: string | null
  notes: string | null
  created_by?: string | null
  created_at: string
}

export type InventoryTransferStatus = 'draft' | 'in_transit' | 'received' | 'cancelled'

export interface InventoryTransferItem {
  id: string
  company_id?: string
  transfer_id: string
  product_id: string
  quantity: number
  received_quantity?: number
  damaged_quantity?: number
  missing_quantity?: number
  notes?: string | null
  receipt_notes?: string | null
  created_at?: string
}

export interface InventoryTransfer {
  id: string
  company_id?: string
  source_warehouse_id: string
  destination_warehouse_id: string
  status: InventoryTransferStatus
  notes: string | null
  created_by?: string | null
  approved_by?: string | null
  received_by?: string | null
  created_at: string
  approved_at: string | null
  received_at: string | null
  updated_at?: string
}

export interface WarehouseReservation {
  id: string
  company_id?: string
  warehouse_id: string
  product_id: string
  quantity: number
  status: 'active' | 'consumed' | 'released' | 'expired'
  reference_type: string | null
  reference_id: string | null
  expires_at: string
  created_at: string
}

export type FinancialBudgetKind =
  | 'ingreso_ventas'
  | 'costo_compras'
  | 'gasto_operativo'
  | 'nomina'

export interface FinancialBudget {
  id: string
  company_id?: string
  period_month: string
  branch_id: string | null
  kind: FinancialBudgetKind
  category_name: string
  budget_amount: number
  notes: string | null
  created_at: string
  updated_at?: string
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'approved'
  | 'sent'
  | 'partial'
  | 'received'
  | 'cancelled'

export interface PurchaseOrderItem {
  id: string
  company_id?: string
  po_id: string
  product_id: string
  product_name: string
  sku: string | null
  ordered_qty: number
  received_qty: number
  rejected_qty: number
  unit_cost: number
  lot_code?: string | null
  expiry_date?: string | null
  notes?: string | null
  created_at?: string
}

export interface PurchaseOrder {
  id: string
  company_id?: string
  po_number: string
  supplier_id: string | null
  supplier_name: string
  branch_id: string | null
  target_warehouse_id: string | null
  status: PurchaseOrderStatus
  payment_terms: 'efectivo' | 'transferencia' | 'tarjeta' | 'credito'
  credit_days: number
  expected_date: string | null
  subtotal: number
  total: number
  notes: string | null
  linked_purchase_id: string | null
  created_by_name: string | null
  approved_by_name: string | null
  approved_at: string | null
  received_at: string | null
  created_at: string
  updated_at?: string
}

export type SupportTicketCategory =
  | 'operacion'
  | 'ventas_pos'
  | 'inventario'
  | 'contabilidad'
  | 'dispositivos'
  | 'facturacion_pdf'
  | 'otro'

export type SupportTicketPriority = 'baja' | 'normal' | 'alta' | 'critica'

export type SupportTicketStatus = 'pendiente' | 'en_revision' | 'resuelto' | 'cerrado'

export type SupportAuthorizationScope = 'lectura_diagnostico' | 'intervencion_asistida'

export interface SupportSessionSnapshot {
  captured_at: string
  active_page: string
  active_page_label: string
  user_role: string
  warehouse_name?: string | null
  branch_name?: string | null
  currency?: string | null
  platform?: string | null
  user_agent?: string | null
  online?: boolean
}

export interface SupportTicket {
  id: string
  ticket_number: string
  company_id: string | null
  company_name: string | null
  user_id: string
  user_name: string
  user_email: string
  user_role: Role
  category: SupportTicketCategory
  priority: SupportTicketPriority
  subject: string
  description: string
  module_page: string | null
  session_authorized: boolean
  authorization_code: string | null
  authorized_at: string | null
  authorized_until: string | null
  revoked_at: string | null
  authorization_scope: SupportAuthorizationScope
  session_snapshot: SupportSessionSnapshot | null
  status: SupportTicketStatus
  assigned_to: string | null
  assigned_name: string | null
  tech_diagnosis: string | null
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
}

export interface CpaProfessionalProfile {
  full_name: string
  license_number: string
  firm_name: string
  title_label: string
  phone: string
  email: string
}

export type CustomerLegalType = 'natural' | 'juridica'

export type CatalogPaymentStatus =
  | 'pendiente_verificacion'
  | 'sin_comprobante'
  | 'verificado'
  | 'observado'
  | 'rechazado'

export type CatalogOrderStatus =
  | 'nuevo'
  | 'alistando'
  | 'despachado'
  | 'entregado'
  | 'cancelado'

export interface CatalogOrderItem {
  product_id: string
  product_name: string
  sku?: string | null
  variant_id?: string | null
  variant_label?: string | null
  stock_multiplier?: number
  quantity: number
  unit_price: number
  subtotal: number
  unit?: string | null
  image_url?: string | null
}

export interface CatalogOrder {
  id: string
  company_id: string
  order_number: string
  tracking_pin: string
  customer_type: CustomerLegalType
  customer_id: string | null
  customer_name: string
  customer_document: string | null
  contact_person: string | null
  requires_fiscal_invoice: boolean
  customer_phone: string
  customer_email: string | null
  delivery_mode: CatalogDeliveryMode
  delivery_address: string | null
  customer_notes: string | null
  items: CatalogOrderItem[]
  subtotal: number
  tax_rate: number
  tax_amount: number
  total: number
  currency: string
  fx_currency?: string | null
  fx_rate?: number | null
  fx_total?: number | null
  payment_method: string
  payment_reference: string | null
  payment_sender_bank: string | null
  payment_amount_reported: number | null
  payment_proof_url: string | null
  payment_status: CatalogPaymentStatus
  order_status: CatalogOrderStatus
  channel_source?: 'catalogo' | 'whatsapp' | 'ruta' | 'pos' | 'api'
  verified_by: string | null
  verified_by_name: string | null
  verified_at: string | null
  admin_notes: string | null
  sale_id: string | null
  quotation_id: string | null
  created_at: string
  updated_at: string
}

/* ============================================================================
 * INVENTARIO PRO: TIPOS PARA LAS 12 INNOVACIONES DE PLATAFORMA INTELIGENTE
 * ========================================================================== */

// 1. Centro Universal de Pedidos Omnicanal
export type OmnichannelSource = 'catalogo' | 'whatsapp' | 'ruta' | 'pos' | 'api'
export type OmnichannelStage = 'recibido' | 'alistamiento' | 'empaque' | 'listo_despacho' | 'en_reparto' | 'entregado' | 'cancelado'

export interface OmnichannelOrder extends CatalogOrder {
  channel: OmnichannelSource
  stage: OmnichannelStage
  assigned_carrier_id?: string | null
  assigned_carrier_name?: string | null
  picking_notes?: string | null
  packing_verified_by?: string | null
  epod_id?: string | null
}

// 2. Agente de IA con Ejecución Bajo Aprobación (Human-in-the-Loop)
export type AiActionType =
  | 'crear_orden_compra'
  | 'ajuste_precio_minimo'
  | 'recordatorio_cartera'
  | 'sugerir_traslado_bodegas'
  | 'bloquear_cliente_riesgo'

export type AiActionStatus = 'pendiente' | 'aprobada' | 'rechazada' | 'ejecutada'

export interface AiActionProposal {
  id: string
  company_id: string
  action_type: AiActionType
  title: string
  explanation: string
  severity: 'alta' | 'media' | 'optimizacion'
  required_role: Role
  payload: Record<string, any>
  created_at: string
  status: AiActionStatus
  approved_by?: string | null
  approved_at?: string | null
  rejection_reason?: string | null
  executed_tx_id?: string | null
}

// 3. Balanceo Predictivo entre Sucursales
export interface BranchStockBalanceSuggestion {
  id: string
  product_id: string
  product_name: string
  sku: string
  source_branch_id: string
  source_branch_name: string
  source_stock: number
  source_days_cover: number
  target_branch_id: string
  target_branch_name: string
  target_stock: number
  target_days_cover: number
  suggested_transfer_qty: number
  estimated_stockout_days: number
  status: 'sugerido' | 'transferido' | 'ignorado'
}

// 4. Inteligencia y Evaluación de Proveedores
export interface SupplierScorecard {
  supplier_id: string
  supplier_name: string
  supplier_document: string | null
  total_orders: number
  completed_orders: number
  on_time_in_full_pct: number // OTIF %
  avg_delay_days: number
  cost_variation_pct_12m: number
  return_rate_pct: number
  grade: 'A+' | 'A' | 'B' | 'C' | 'D'
  active_alerts: string[]
  last_purchase_date: string | null
}

// 5. Detección de Anomalías y Prevención de Pérdidas
export type AnomalySeverity = 'critica' | 'moderada' | 'informativa'
export type AnomalyCategory = 'caja_arqueo' | 'descuento_inusual' | 'devolucion_sospechosa' | 'merma_ciega' | 'margen_negativo'

export interface AnomalyRecord {
  id: string
  company_id: string
  category: AnomalyCategory
  severity: AnomalySeverity
  title: string
  description: string
  involved_user_name: string | null
  involved_branch: string | null
  financial_impact: number
  detected_at: string
  status: 'pendiente_revision' | 'justificado' | 'sancionado'
  reviewed_by?: string | null
  resolution_notes?: string | null
}

// 6. Prueba Digital de Entrega y Recepción (e-POD)
export interface EpodRecord {
  id: string
  company_id: string
  order_id: string
  order_number: string
  customer_name: string
  customer_phone: string
  delivery_address: string
  carrier_id: string
  carrier_name: string
  received_by_name: string
  received_by_document: string
  signature_data_url: string // Canvas Signature PNG Base64
  photo_proof_url?: string | null
  gps_latitude?: number | null
  gps_longitude?: number | null
  gps_accuracy_meters?: number | null
  delivered_at: string
  sync_status: 'online' | 'local_pending'
}

// 7. Gestión de Maquinaria, Activos Fijos y Mantenimiento
export type AssetStatus = 'operativo' | 'en_mantenimiento' | 'baja'
export type MaintenanceStatus = 'al_dia' | 'proximo' | 'vencido'

export interface EquipmentAsset {
  id: string
  company_id: string
  asset_code: string
  name: string
  category: 'vehiculo' | 'frio_congelador' | 'balanza' | 'impresora_pos' | 'computo' | 'maquinaria'
  serial_number: string | null
  branch_id: string
  branch_name: string
  purchase_date: string | null
  warranty_expires_at: string | null
  acquisition_cost: number
  status: AssetStatus
  maintenance_interval_days: number
  last_maintenance_at: string | null
  next_maintenance_at: string
  maintenance_status: MaintenanceStatus
  odometer_or_hours?: number | null
  cost_center_id?: string | null
  notes?: string | null
}

export interface MaintenanceLog {
  id: string
  asset_id: string
  asset_name: string
  maintenance_type: 'preventivo' | 'correctivo' | 'calibracion'
  cost: number
  technician_provider: string
  performed_at: string
  notes: string
  expense_id?: string | null
}

// 8. Portal de Autoservicio para Vendedores
export interface EmployeeTargetSummary {
  employee_id: string
  employee_name: string
  current_month_label: string
  sales_target: number
  sales_achieved: number
  sales_progress_pct: number
  collections_target: number
  collections_achieved: number
  earned_commission_total: number
  paid_commission_total: number
  pending_commission_balance: number
  assigned_customers_count: number
  pending_visits_count: number
}

// 9. Conciliación Inteligente y Anti-Fraude
export interface DuplicateReceiptWarning {
  reference: string
  sender_bank: string
  amount: number
  original_order_number: string
  original_customer_name: string
  original_date: string
  current_order_number: string
}

// 10. Cumplimiento, Vencimientos y Calendario Legal
export type ComplianceCategory = 'camara_comercio' | 'transporte_soat' | 'bomberos_sanidad' | 'impuesto_fiscal' | 'contrato_arriendo' | 'lote_perecedero'
export type ComplianceUrgency = 'vigente' | 'proximo_vencer' | 'vencido'

export interface ComplianceItem {
  id: string
  company_id: string
  title: string
  category: ComplianceCategory
  due_date: string
  urgency: ComplianceUrgency
  days_left: number
  estimated_cost?: number | null
  responsible_person?: string | null
  attachment_url?: string | null
  notes?: string | null
  completed_at?: string | null
}

// 11. API Pública y Ecosistema de Integraciones
export interface ApiKeyRecord {
  id: string
  company_id: string
  key_label: string
  api_key_masked: string
  api_key_hash: string
  permissions: ('read_stock' | 'create_orders' | 'read_products' | 'read_customers')[]
  created_at: string
  last_used_at?: string | null
  is_active: boolean
}

export interface WebhookSubscription {
  id: string
  company_id: string
  target_url: string
  secret_token: string
  events: ('order.created' | 'order.status_changed' | 'inventory.low_stock' | 'delivery.completed')[]
  is_active: boolean
  last_delivery_status?: 'success' | 'failed' | null
  last_delivery_at?: string | null
}

// 12. Pase de Soporte Técnico Temporal
export type SupportScopeLevel = 'diagnostico_solo_lectura' | 'asistencia_pos_inventario' | 'soporte_total_aprobado'

export interface SupportPassSession {
  id: string
  company_id: string
  company_name: string
  access_code: string
  scope_level: SupportScopeLevel
  authorized_by_name: string
  authorized_by_role: Role
  expires_at: string
  is_active: boolean
  ip_address?: string | null
  device_info?: string | null
  created_at: string
  revoked_at?: string | null
}


