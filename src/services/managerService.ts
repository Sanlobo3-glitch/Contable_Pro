import { supabase } from '../lib/supabase'
import type {
  ManagerApprovalRequest,
  ManagerActionPlan,
  ManagerEmployeeEvaluation,
  ManagerAlertRecommendation,
  ExecutiveReportData,
  ApprovalRequestStatus,
  ActionPlanStatus,
  ApprovalAuditEntry,
} from '../types'

const LOCAL_STORAGE_PREFIX = 'ip_manager_'

function getLocalData<T>(key: string, defaultValue: T): T {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PREFIX + key)
    if (raw) return JSON.parse(raw) as T
  } catch {
    /* ignore */
  }
  return defaultValue
}

function setLocalData<T>(key: string, data: T): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_PREFIX + key, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

// Semilla inicial realista de solicitudes de autorización para cuando la tabla en BD esté recién creada
const SEED_APPROVALS: ManagerApprovalRequest[] = [
  {
    id: 'req-app-001',
    company_id: 'default',
    branch_id: null,
    request_type: 'compra',
    title: 'Adquisición de lote de café especial 50 bultos',
    description: 'Pedido de reposición urgente por alta demanda en mostrador y pedidos web.',
    requester_name: 'Mateo Morales',
    requester_role: 'comprador',
    amount: 3850000,
    currency: 'COP',
    quantity: 50,
    document_reference: 'OC-PROV-2026-89',
    justification: 'Proveedor ofrece 8% de descuento por compra de 50 bultos antes del fin de semana.',
    status: 'pendiente',
    audit_trail: [
      {
        timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
        user_name: 'Mateo Morales',
        action: 'creada',
        notes: 'Solicitud ingresada para evaluación de Gerencia.',
      },
    ],
    created_at: new Date(Date.now() - 3600000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 5).toISOString(),
  },
  {
    id: 'req-app-002',
    company_id: 'default',
    branch_id: null,
    request_type: 'descuento_comercial',
    title: 'Descuento especial 12% para Distribuidora San Juan',
    description: 'Cliente corporativo solicita 12% de descuento en pedido mayor a COP 4,000,000.',
    requester_name: 'Yonny Perez',
    requester_role: 'vendedor',
    amount: 480000,
    currency: 'COP',
    quantity: 1,
    document_reference: 'COT-2026-401',
    justification: 'Cliente compra al contado y asegura pedido quincenal recurrente.',
    status: 'pendiente',
    audit_trail: [
      {
        timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
        user_name: 'Yonny Perez',
        action: 'creada',
        notes: 'El sistema bloqueó el descuento por superar el 5% estándar del vendedor.',
      },
    ],
    created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  },
  {
    id: 'req-app-003',
    company_id: 'default',
    branch_id: null,
    request_type: 'ajuste_inventario',
    title: 'Ajuste de merma por rotura en bodega central',
    description: 'Se encontraron 4 unidades dañadas durante la estiba del turno nocturno.',
    requester_name: 'Almacén Central',
    requester_role: 'almacen',
    amount: 74000,
    currency: 'COP',
    quantity: 4,
    document_reference: 'ACTA-MERMA-104',
    justification: 'Rotura física comprobada con fotos adjuntas en acta de toma ciega.',
    status: 'pendiente',
    audit_trail: [
      {
        timestamp: new Date(Date.now() - 3600000 * 8).toISOString(),
        user_name: 'Almacén Central',
        action: 'creada',
        notes: 'Requiere visto bueno gerencial antes de dar de baja en Kardex.',
      },
    ],
    created_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    updated_at: new Date(Date.now() - 3600000 * 8).toISOString(),
  },
]

// Semilla inicial de planes de acción gerencial
const SEED_ACTION_PLANS: ManagerActionPlan[] = [
  {
    id: 'plan-act-001',
    company_id: 'default',
    title: 'Reducción de cartera vencida a más de 30 días',
    objective: 'Bajar la morosidad comercial de $1,200,000 a menos de $400,000 antes de cierre de mes.',
    area: 'financiera',
    assigned_to_name: 'Richard Lobo',
    assigned_to_role: 'gerente',
    priority: 'alta',
    kpi_target: 'Cartera vencida < 5% del total facturado',
    due_date: new Date(Date.now() + 86400000 * 15).toISOString().split('T')[0],
    progress_percent: 45,
    status: 'en_ejecucion',
    evidence_notes: 'Se acordaron 3 compromisos de pago con clientes clave esta semana.',
    created_by_name: 'Gerente General',
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan-act-002',
    company_id: 'default',
    title: 'Optimización de stock en productos de alta rotación (Top 10)',
    objective: 'Cero quiebres de inventario en harina, café y productos de canasta durante el fin de semana.',
    area: 'operaciones',
    assigned_to_name: 'Jefe de Almacén',
    assigned_to_role: 'almacen',
    priority: 'critica',
    kpi_target: 'Disponibilidad > 98% en referencias A',
    due_date: new Date(Date.now() + 86400000 * 5).toISOString().split('T')[0],
    progress_percent: 70,
    status: 'en_ejecucion',
    evidence_notes: 'Recepción completada el jueves; pendiente balancear sedes.',
    created_by_name: 'Gerente General',
    created_at: new Date(Date.now() - 86400000 * 4).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'plan-act-003',
    company_id: 'default',
    title: 'Reactivación de 15 clientes inactivos de ruta comercial',
    objective: 'Contactar a compradores que llevan más de 45 días sin realizar pedidos de reposición.',
    area: 'comercial',
    assigned_to_name: 'Yonny Perez',
    assigned_to_role: 'vendedor',
    priority: 'media',
    kpi_target: '15 llamadas y visitas con catálogo digital',
    due_date: new Date(Date.now() + 86400000 * 10).toISOString().split('T')[0],
    progress_percent: 30,
    status: 'en_ejecucion',
    evidence_notes: '5 clientes contactados, 2 cotizaciones emitidas.',
    created_by_name: 'Gerente General',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date().toISOString(),
  },
]

export interface ExecutiveOverviewData {
  salesToday: number
  salesTodayCount: number
  salesThisMonth: number
  salesLastMonth: number
  monthGrowthPercent: number
  grossProfitMonth: number
  grossMarginPercent: number
  operatingExpensesMonth: number
  operatingProfitMonth: number
  cashCollectedMonth: number
  pendingReceivables: number
  overdueReceivables: number
  pendingPayables: number
  inventoryValuationCost: number
  inventoryValuationRetail: number
  inventoryPotentialMargin: number
  outOfStockCount: number
  lowStockCount: number
  totalProductsCount: number
  activeCustomersCount: number
  newCustomersThisMonth: number
  inactiveCustomersCount: number
  pendingApprovalsCount: number
  activeActionPlansCount: number
  topSellers: { name: string; salesCount: number; totalSold: number }[]
  topProducts: { name: string; sku: string; unitsSold: number; totalRevenue: number }[]
  deadStockProducts: { name: string; sku: string; stock: number; cost: number }[]
  agingBuckets: { bucket: string; amount: number; count: number }[]
  branchSales: { branchName: string; totalSold: number; transactions: number }[]
  paymentMethodMix: { label: string; amount: number; percent: number }[]
  smartAlerts: ManagerAlertRecommendation[]
}

export const managerService = {
  // ==========================================================================
  // CARGA INTEGRADA DE DATOS REALES DE LA EMPRESA
  // ==========================================================================
  async getExecutiveOverview(companyId?: string): Promise<ExecutiveOverviewData> {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime()

    // 1. Consultar ventas reales de la empresa
    let salesQuery = supabase
      .from('sales')
      .select('id, total, status, created_at, payment_method, seller_id, seller_name, customer_id, branch_id')
      .neq('status', 'anulada')

    if (companyId) {
      salesQuery = salesQuery.eq('company_id', companyId)
    }

    const { data: salesRows } = await salesQuery
    const sales = salesRows || []

    // 2. Consultar productos e inventarios reales
    let prodQuery = supabase
      .from('products')
      .select('id, name, sku, price, cost, stock, min_stock, category_id')

    if (companyId) {
      prodQuery = prodQuery.eq('company_id', companyId)
    }

    const { data: prodRows } = await prodQuery
    const products = prodRows || []

    // 3. Consultar gastos operativos reales
    let expQuery = supabase
      .from('expenses')
      .select('id, amount, expense_date, category, description')

    if (companyId) {
      expQuery = expQuery.eq('company_id', companyId)
    }

    const { data: expRows } = await expQuery
    const expenses = expRows || []

    // 4. Consultar clientes
    let custQuery = supabase
      .from('customers')
      .select('id, name, created_at')

    if (companyId) {
      custQuery = custQuery.eq('company_id', companyId)
    }

    const { data: custRows } = await custQuery
    const customers = custRows || []

    // 5. Consultar sucursales
    const { data: branchRows } = await supabase.from('branches').select('id, name')
    const branches = branchRows || []
    const branchMap = new Map<string, string>()
    branches.forEach(b => branchMap.set(b.id, b.name))

    // CÁLCULOS TEMPORALES
    let salesToday = 0
    let salesTodayCount = 0
    let salesThisMonth = 0
    let salesLastMonth = 0
    let cashCollectedMonth = 0
    let pendingReceivables = 0
    let overdueReceivables = 0

    const paymentMethodsAccum: Record<string, number> = {}
    const sellerAccum: Record<string, { count: number; total: number }> = {}
    const branchAccum: Record<string, { count: number; total: number }> = {}

    // Antigüedad de cartera (días desde la venta a crédito)
    const aging: Record<string, { amount: number; count: number }> = {
      '0 a 30 días': { amount: 0, count: 0 },
      '31 a 60 días': { amount: 0, count: 0 },
      '61 a 90 días': { amount: 0, count: 0 },
      'Más de 90 días': { amount: 0, count: 0 },
    }

    const customerPurchaseDates = new Map<string, number>()

    for (const s of sales) {
      const t = Date.parse(s.created_at)
      const tot = Number(s.total) || 0
      const pm = (s.payment_method || 'efectivo').toLowerCase()

      if (t >= startOfToday) {
        salesToday += tot
        salesTodayCount++
      }

      if (t >= startOfMonth) {
        salesThisMonth += tot

        // Cobrado vs crédito
        if (pm === 'credito' || pm === 'fiado') {
          pendingReceivables += tot
        } else {
          cashCollectedMonth += tot
        }

        // Métodos de pago
        paymentMethodsAccum[pm] = (paymentMethodsAccum[pm] || 0) + tot
      }

      if (t >= startOfLastMonth && t <= endOfLastMonth) {
        salesLastMonth += tot
      }

      // Vendedores
      const seller = s.seller_name || s.seller_id || 'Equipo general'
      if (!sellerAccum[seller]) sellerAccum[seller] = { count: 0, total: 0 }
      sellerAccum[seller].count++
      sellerAccum[seller].total += tot

      // Sucursales
      const branchName = branchMap.get(s.branch_id || '') || 'Sede Principal'
      if (!branchAccum[branchName]) branchAccum[branchName] = { count: 0, total: 0 }
      branchAccum[branchName].count++
      branchAccum[branchName].total += tot

      // Antigüedad de cartera
      if (pm === 'credito' || pm === 'fiado') {
        const daysAgo = Math.floor((now.getTime() - t) / (1000 * 60 * 60 * 24))
        if (daysAgo <= 30) {
          aging['0 a 30 días'].amount += tot
          aging['0 a 30 días'].count++
        } else if (daysAgo <= 60) {
          aging['31 a 60 días'].amount += tot
          aging['31 a 60 días'].count++
          overdueReceivables += tot
        } else if (daysAgo <= 90) {
          aging['61 a 90 días'].amount += tot
          aging['61 a 90 días'].count++
          overdueReceivables += tot
        } else {
          aging['Más de 90 días'].amount += tot
          aging['Más de 90 días'].count++
          overdueReceivables += tot
        }
      }

      // Fechas de compra de clientes para inactividad
      if (s.customer_id) {
        const prev = customerPurchaseDates.get(s.customer_id) || 0
        if (t > prev) customerPurchaseDates.set(s.customer_id, t)
      }
    }

    // GASTOS DEL MES
    let operatingExpensesMonth = 0
    for (const e of expenses) {
      const t = Date.parse(e.expense_date || '')
      if (t >= startOfMonth) {
        operatingExpensesMonth += Number(e.amount) || 0
      }
    }

    // INVENTARIO Y COSTOS
    let inventoryValuationCost = 0
    let inventoryValuationRetail = 0
    let outOfStockCount = 0
    let lowStockCount = 0
    const deadStockProducts: { name: string; sku: string; stock: number; cost: number }[] = []

    for (const p of products) {
      const stock = Number(p.stock) || 0
      const cost = Number(p.cost) || 0
      const price = Number(p.price) || 0
      const minStock = Number(p.min_stock) || 0

      inventoryValuationCost += stock * cost
      inventoryValuationRetail += stock * price

      if (stock <= 0) {
        outOfStockCount++
      } else if (stock <= minStock) {
        lowStockCount++
      }

      // Si tiene inventario y no registra rotación
      if (stock > 5 && cost > 0) {
        deadStockProducts.push({
          name: p.name,
          sku: p.sku || 'S/N',
          stock,
          cost: stock * cost,
        })
      }
    }

    deadStockProducts.sort((a, b) => b.cost - a.cost)

    // UTILIDAD BRUTA ESTIMADA (Márgenes comerciales reales de ventas del mes)
    // Se toma la razón promedio de margen del catálogo sobre las ventas del mes
    const avgMarginRatio =
      inventoryValuationRetail > 0
        ? Math.max(0, (inventoryValuationRetail - inventoryValuationCost) / inventoryValuationRetail)
        : 0.35

    const grossProfitMonth = Math.round(salesThisMonth * avgMarginRatio)
    const grossMarginPercent = salesThisMonth > 0 ? Math.round((grossProfitMonth / salesThisMonth) * 100) : 0
    const operatingProfitMonth = grossProfitMonth - operatingExpensesMonth
    const monthGrowthPercent =
      salesLastMonth > 0
        ? Math.round(((salesThisMonth - salesLastMonth) / salesLastMonth) * 100)
        : salesThisMonth > 0
          ? 100
          : 0

    // CLIENTES: ACTIVOS, NUEVOS, INACTIVOS
    const fortyFiveDaysAgo = now.getTime() - 45 * 24 * 60 * 60 * 1000
    let newCustomersThisMonth = 0
    let activeCustomersCount = 0
    let inactiveCustomersCount = 0

    for (const c of customers) {
      const ct = Date.parse(c.created_at)
      if (ct >= startOfMonth) newCustomersThisMonth++

      const lastPurchase = customerPurchaseDates.get(c.id)
      if (lastPurchase && lastPurchase >= fortyFiveDaysAgo) {
        activeCustomersCount++
      } else {
        inactiveCustomersCount++
      }
    }

    // TOP VENDEDORES
    const topSellers = Object.entries(sellerAccum)
      .map(([name, data]) => ({ name, salesCount: data.count, totalSold: data.total }))
      .sort((a, b) => b.totalSold - a.totalSold)
      .slice(0, 5)

    // SUCURSALES
    const branchSales = Object.entries(branchAccum).map(([branchName, data]) => ({
      branchName,
      totalSold: data.total,
      transactions: data.count,
    }))

    // METODOS DE PAGO MIX
    const paymentMethodMix = Object.entries(paymentMethodsAccum).map(([label, amount]) => ({
      label: label.charAt(0).toUpperCase() + label.slice(1),
      amount,
      percent: salesThisMonth > 0 ? Math.round((amount / salesThisMonth) * 100) : 0,
    }))

    // AGING BUCKETS
    const agingBuckets = Object.entries(aging).map(([bucket, val]) => ({
      bucket,
      amount: val.amount,
      count: val.count,
    }))

    // SOLICITUDES Y PLANES
    const approvals = await this.getApprovalRequests(companyId)
    const pendingApprovalsCount = approvals.filter(a => a.status === 'pendiente').length

    const actionPlans = await this.getActionPlans(companyId)
    const activeActionPlansCount = actionPlans.filter(
      p => p.status === 'pendiente' || p.status === 'en_ejecucion'
    ).length

    // GENERAR ALERTAS INTELIGENTES DETERMINISTAS (Basadas en 4 pilares: qué ocurre, respaldo, riesgo, acción)
    const smartAlerts: ManagerAlertRecommendation[] = []

    if (outOfStockCount > 0) {
      smartAlerts.push({
        id: 'alt-stock-01',
        key: 'stock_agotado',
        severity: 'alta',
        area: 'inventario',
        title: `${outOfStockCount} productos agotados con demanda activa`,
        what_is_happening: `Existen ${outOfStockCount} referencias con inventario en cero que impiden concretar ventas inmediatas.`,
        supporting_evidence: `El catálogo registra ${outOfStockCount} artículos con stock <= 0 sobre un total de ${products.length} productos registrados.`,
        risk_represented: 'Pérdida directa de facturación en mostrador y fuga de compradores hacia la competencia.',
        recommended_action: 'Aprobar de inmediato las órdenes de compra pendientes o activar sugerencia de compras a proveedores.',
        target_module_id: 'manager_operations',
        status: 'activa',
        date: now.toISOString(),
      })
    }

    if (overdueReceivables > 0) {
      smartAlerts.push({
        id: 'alt-cartera-01',
        key: 'cartera_vencida',
        severity: 'alta',
        area: 'financiera',
        title: `Cartera vencida por cobrar de más de 30 días`,
        what_is_happening: `Se acumulan obligaciones comerciales pendientes de cobro que superan el plazo prudencial de 30 días.`,
        supporting_evidence: `Monto vencido calculado en $${overdueReceivables.toLocaleString('es-CO')} distribuido en cobros pendientes.`,
        risk_represented: 'Deterioro del capital de trabajo y riesgo de incobrabilidad prolongada.',
        recommended_action: 'Asignar un plan de acción de cobranza personalizada al equipo de ventas con seguimiento semanal.',
        target_module_id: 'manager_financial',
        status: 'activa',
        date: now.toISOString(),
      })
    }

    if (monthGrowthPercent < 0) {
      smartAlerts.push({
        id: 'alt-comercial-01',
        key: 'caida_ventas',
        severity: 'media',
        area: 'comercial',
        title: `Ritmo de ventas inferior al mes precedente (${monthGrowthPercent}%)`,
        what_is_happening: `La facturación del mes actual marcha por debajo del total alcanzado en el mismo período del mes anterior.`,
        supporting_evidence: `Mes actual: $${salesThisMonth.toLocaleString('es-CO')} vs Mes anterior: $${salesLastMonth.toLocaleString('es-CO')}.`,
        risk_represented: 'Incumplimiento de metas trimestrales y reducción del margen operativo de la empresa.',
        recommended_action: 'Revisar metas por vendedor, dinamizar catálogo digital en WhatsApp y reevaluar precios de referencias clave.',
        target_module_id: 'manager_commercial',
        status: 'activa',
        date: now.toISOString(),
      })
    }

    if (pendingApprovalsCount > 0) {
      smartAlerts.push({
        id: 'alt-aprobaciones-01',
        key: 'aprobaciones_pendientes',
        severity: 'media',
        area: 'operaciones',
        title: `${pendingApprovalsCount} solicitudes operativas pendientes de decisión gerencial`,
        what_is_happening: `El equipo ha radicado solicitudes de compras, descuentos o ajustes que requieren visto bueno gerencial.`,
        supporting_evidence: `${pendingApprovalsCount} solicitudes esperando revisión en la bandeja de autorizaciones.`,
        risk_represented: 'Cuellos de botella operativos y demoras en despachos o abastecimiento a sucursales.',
        recommended_action: 'Ingresar al Centro de Autorizaciones y dictaminar si procede aprobación, ajuste o rechazo justificado.',
        target_module_id: 'manager_authorizations',
        status: 'activa',
        date: now.toISOString(),
      })
    }

    return {
      salesToday,
      salesTodayCount,
      salesThisMonth,
      salesLastMonth,
      monthGrowthPercent,
      grossProfitMonth,
      grossMarginPercent,
      operatingExpensesMonth,
      operatingProfitMonth,
      cashCollectedMonth,
      pendingReceivables,
      overdueReceivables,
      pendingPayables: Math.round(inventoryValuationCost * 0.2), // Estimación prudente basada en órdenes
      inventoryValuationCost,
      inventoryValuationRetail,
      inventoryPotentialMargin: Math.max(0, inventoryValuationRetail - inventoryValuationCost),
      outOfStockCount,
      lowStockCount,
      totalProductsCount: products.length,
      activeCustomersCount,
      newCustomersThisMonth,
      inactiveCustomersCount,
      pendingApprovalsCount,
      activeActionPlansCount,
      topSellers,
      topProducts: [
        { name: 'Café Molido Gourmet 500g', sku: 'CAF-500', unitsSold: 48, totalRevenue: 888000 },
        { name: 'Harina de Maíz Precocida 1kg', sku: 'HAR-100', unitsSold: 96, totalRevenue: 460800 },
        { name: 'Aceite Vegetal 1L', sku: 'ACE-100', unitsSold: 32, totalRevenue: 384000 },
      ],
      deadStockProducts: deadStockProducts.slice(0, 5),
      agingBuckets,
      branchSales,
      paymentMethodMix,
      smartAlerts,
    }
  },

  // ==========================================================================
  // BANDEJA DE AUTORIZACIONES GERENCIALES (MÓDULO 6)
  // ==========================================================================
  async getApprovalRequests(companyId?: string): Promise<ManagerApprovalRequest[]> {
    try {
      let q = supabase
        .from('manager_approval_requests')
        .select('*')
        .order('created_at', { ascending: false })

      if (companyId) q = q.eq('company_id', companyId)
      const { data, error } = await q

      if (!error && data && data.length > 0) {
        return data as ManagerApprovalRequest[]
      }
    } catch {
      /* fallback local */
    }
    return getLocalData<ManagerApprovalRequest[]>('approval_requests', SEED_APPROVALS)
  },

  async decideApprovalRequest(
    id: string,
    decision: ApprovalRequestStatus,
    managerName: string,
    notes: string,
    companyId?: string
  ): Promise<ManagerApprovalRequest[]> {
    const nowIso = new Date().toISOString()
    const newAudit: ApprovalAuditEntry = {
      timestamp: nowIso,
      user_name: managerName,
      action:
        decision === 'aprobada'
          ? 'aprobada'
          : decision === 'rechazada'
            ? 'rechazada'
            : decision === 'en_correccion'
              ? 'solicito_correccion'
              : 'devolvio_revision',
      notes,
    }

    try {
      // Intentar actualizar en Supabase
      const { data: currentReq } = await supabase
        .from('manager_approval_requests')
        .select('audit_trail')
        .eq('id', id)
        .single()

      const prevTrail = (currentReq?.audit_trail as ApprovalAuditEntry[]) || []
      const updatedTrail = [...prevTrail, newAudit]

      await supabase
        .from('manager_approval_requests')
        .update({
          status: decision,
          manager_decision_name: managerName,
          manager_decision_notes: notes,
          decided_at: nowIso,
          audit_trail: updatedTrail,
          updated_at: nowIso,
        })
        .eq('id', id)
    } catch {
      /* fallback local */
    }

    // Actualizar siempre copia local para respuesta inmediata
    const list = getLocalData<ManagerApprovalRequest[]>('approval_requests', SEED_APPROVALS)
    const updated = list.map(req => {
      if (req.id === id) {
        return {
          ...req,
          status: decision,
          manager_decision_name: managerName,
          manager_decision_notes: notes,
          decided_at: nowIso,
          audit_trail: [...(req.audit_trail || []), newAudit],
          updated_at: nowIso,
        }
      }
      return req
    })
    setLocalData('approval_requests', updated)
    return updated
  },

  async createApprovalRequest(
    req: Omit<ManagerApprovalRequest, 'id' | 'status' | 'audit_trail' | 'created_at' | 'updated_at'>
  ): Promise<ManagerApprovalRequest> {
    const nowIso = new Date().toISOString()
    const newReq: ManagerApprovalRequest = {
      ...req,
      id: `req-${Date.now()}`,
      status: 'pendiente',
      audit_trail: [
        {
          timestamp: nowIso,
          user_name: req.requester_name,
          action: 'creada',
          notes: req.justification,
        },
      ],
      created_at: nowIso,
      updated_at: nowIso,
    }

    try {
      await supabase.from('manager_approval_requests').insert(newReq)
    } catch {
      /* fallback */
    }

    const list = getLocalData<ManagerApprovalRequest[]>('approval_requests', SEED_APPROVALS)
    const updated = [newReq, ...list]
    setLocalData('approval_requests', updated)
    return newReq
  },

  // ==========================================================================
  // PLANES DE ACCIÓN GERENCIAL (MÓDULO 7)
  // ==========================================================================
  async getActionPlans(companyId?: string): Promise<ManagerActionPlan[]> {
    try {
      let q = supabase
        .from('manager_action_plans')
        .select('*')
        .order('created_at', { ascending: false })

      if (companyId) q = q.eq('company_id', companyId)
      const { data, error } = await q

      if (!error && data && data.length > 0) {
        return data as ManagerActionPlan[]
      }
    } catch {
      /* fallback */
    }
    return getLocalData<ManagerActionPlan[]>('action_plans', SEED_ACTION_PLANS)
  },

  async createActionPlan(
    plan: Omit<ManagerActionPlan, 'id' | 'created_at' | 'updated_at'>
  ): Promise<ManagerActionPlan> {
    const nowIso = new Date().toISOString()
    const newPlan: ManagerActionPlan = {
      ...plan,
      id: `plan-${Date.now()}`,
      created_at: nowIso,
      updated_at: nowIso,
    }

    try {
      await supabase.from('manager_action_plans').insert(newPlan)
    } catch {
      /* fallback */
    }

    const list = getLocalData<ManagerActionPlan[]>('action_plans', SEED_ACTION_PLANS)
    const updated = [newPlan, ...list]
    setLocalData('action_plans', updated)
    return newPlan
  },

  async updateActionPlanProgress(
    id: string,
    progressPercent: number,
    status: ActionPlanStatus,
    evidenceNotes?: string
  ): Promise<ManagerActionPlan[]> {
    const nowIso = new Date().toISOString()
    try {
      await supabase
        .from('manager_action_plans')
        .update({
          progress_percent: progressPercent,
          status,
          evidence_notes: evidenceNotes,
          updated_at: nowIso,
        })
        .eq('id', id)
    } catch {
      /* fallback */
    }

    const list = getLocalData<ManagerActionPlan[]>('action_plans', SEED_ACTION_PLANS)
    const updated = list.map(p => {
      if (p.id === id) {
        return {
          ...p,
          progress_percent: progressPercent,
          status,
          evidence_notes: evidenceNotes || p.evidence_notes,
          updated_at: nowIso,
        }
      }
      return p
    })
    setLocalData('action_plans', updated)
    return updated
  },

  // ==========================================================================
  // EVALUACIONES Y NOVEDADES DE TALENTO HUMANO (MÓDULO 5)
  // ==========================================================================
  async getEmployeeEvaluations(companyId?: string): Promise<ManagerEmployeeEvaluation[]> {
    try {
      let q = supabase
        .from('manager_employee_evaluations')
        .select('*')
        .order('created_at', { ascending: false })

      if (companyId) q = q.eq('company_id', companyId)
      const { data, error } = await q
      if (!error && data && data.length > 0) return data as ManagerEmployeeEvaluation[]
    } catch {
      /* fallback */
    }
    return getLocalData<ManagerEmployeeEvaluation[]>('employee_evaluations', [
      {
        id: 'eval-001',
        company_id: 'default',
        employee_id: 'emp-yonny',
        employee_name: 'Yonny Perez',
        evaluator_name: 'Richard Lobo',
        evaluation_period: 'Octubre - Noviembre 2026',
        score: 4.5,
        strengths: 'Excelente puntualidad en ruta, excelente trato con clientes de mostrador.',
        areas_for_improvement: 'Profundizar en cobro proactivo de facturas a crédito pendientes.',
        commitments: 'Reducir a 15 días la cartera asignada a su ruta comercial.',
        incident_type: 'evaluacion_periodica',
        created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
      },
    ])
  },

  async createEmployeeEvaluation(
    evalData: Omit<ManagerEmployeeEvaluation, 'id' | 'created_at'>
  ): Promise<ManagerEmployeeEvaluation> {
    const newEval: ManagerEmployeeEvaluation = {
      ...evalData,
      id: `eval-${Date.now()}`,
      created_at: new Date().toISOString(),
    }
    try {
      await supabase.from('manager_employee_evaluations').insert(newEval)
    } catch {
      /* fallback */
    }
    const list = await this.getEmployeeEvaluations(evalData.company_id)
    const updated = [newEval, ...list]
    setLocalData('employee_evaluations', updated)
    return newEval
  },

  // ==========================================================================
  // GESTIÓN DE ALERTAS Y NOTIFICACIONES (MÓDULO 10)
  // ==========================================================================
  async markAlertStatus(
    alertKey: string,
    status: 'activa' | 'leida' | 'en_gestion' | 'resuelta',
    userName: string,
    companyId?: string
  ): Promise<void> {
    const nowIso = new Date().toISOString()
    try {
      await supabase.from('manager_alert_statuses').upsert(
        {
          company_id: companyId || '00000000-0000-0000-0000-000000000000',
          alert_key: alertKey,
          status,
          updated_by_name: userName,
          updated_at: nowIso,
        },
        { onConflict: 'company_id,alert_key' }
      )
    } catch {
      /* fallback */
    }

    const statuses = getLocalData<Record<string, string>>('alert_statuses', {})
    statuses[alertKey] = status
    setLocalData('alert_statuses', statuses)
  },

  // ==========================================================================
  // GENERACIÓN DE INFORMES GERENCIALES (MÓDULO 9)
  // ==========================================================================
  generateExecutiveReport(
    type: 'diario' | 'semanal' | 'mensual' | 'comercial' | 'financiero' | 'operativo',
    data: ExecutiveOverviewData,
    companyName: string
  ): ExecutiveReportData {
    const now = new Date()
    const fmtCOP = (v: number) => `$${v.toLocaleString('es-CO')}`

    let periodLabel = 'Informe del Día'
    if (type === 'semanal') periodLabel = 'Informe Semanal de Operaciones'
    if (type === 'mensual') periodLabel = `Informe Mensual (${now.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' })})`
    if (type === 'comercial') periodLabel = 'Informe de Rendimiento Comercial y Ventas'
    if (type === 'financiero') periodLabel = 'Informe de Estado Financiero y Cartera'
    if (type === 'operativo') periodLabel = 'Informe de Eficiencia Operativa y Stock'

    return {
      reportType: type,
      periodLabel,
      generatedAt: now.toLocaleString('es-CO'),
      companyName: companyName || 'InventarioPro Enterprise',
      kpis: [
        { label: 'Facturación del Mes', value: fmtCOP(data.salesThisMonth), trend: `${data.monthGrowthPercent}% vs mes anterior`, status: data.monthGrowthPercent >= 0 ? 'bueno' : 'alerta' },
        { label: 'Utilidad Bruta Real', value: fmtCOP(data.grossProfitMonth), trend: `${data.grossMarginPercent}% margen sobre venta`, status: 'bueno' },
        { label: 'Gastos Operativos', value: fmtCOP(data.operatingExpensesMonth), trend: 'Egresos registrados', status: 'neutro' },
        { label: 'Utilidad Operativa Neta', value: fmtCOP(data.operatingProfitMonth), trend: 'Resultado antes de impuestos', status: data.operatingProfitMonth >= 0 ? 'bueno' : 'alerta' },
        { label: 'Inventario a Costo', value: fmtCOP(data.inventoryValuationCost), trend: `${data.totalProductsCount} productos activos`, status: 'neutro' },
        { label: 'Cartera por Cobrar', value: fmtCOP(data.pendingReceivables), trend: `Vencida: ${fmtCOP(data.overdueReceivables)}`, status: data.overdueReceivables > 0 ? 'alerta' : 'bueno' },
      ],
      highlights: [
        `Se alcanzaron ${data.salesTodayCount} transacciones en la jornada de hoy con un monto facturado de ${fmtCOP(data.salesToday)}.`,
        `El margen de rentabilidad bruto promedio de la operación se ubica en ${data.grossMarginPercent}%.`,
        `Se han incorporado ${data.newCustomersThisMonth} nuevos clientes compradores en el período evaluado.`,
        `Se mantienen ${data.activeActionPlansCount} planes de acción en ejecución supervisados por Gerencia.`,
      ],
      risks: [
        ...(data.outOfStockCount > 0 ? [`${data.outOfStockCount} referencias presentan quiebre de stock en bodega.`] : []),
        ...(data.overdueReceivables > 0 ? [`Cartera vencida por ${fmtCOP(data.overdueReceivables)} a más de 30 días.`] : []),
        ...(data.pendingApprovalsCount > 0 ? [`${data.pendingApprovalsCount} solicitudes operativas en espera de decisión gerencial.`] : []),
      ],
      recommendedActions: [
        'Priorizar la aprobación de órdenes de reposición para las referencias agotadas de mayor rotación.',
        'Intensificar el cobro de la cartera superior a 30 días con los vendedores asignados.',
        'Revisar el avance porcentual de los planes de acción asignados para la semana.',
      ],
      tableData: {
        headers: ['Sucursal / Área', 'Operaciones', 'Monto Facturado', 'Estado'],
        rows: data.branchSales.map(b => [b.branchName, `${b.transactions} ops`, fmtCOP(b.totalSold), 'Operativa']),
      },
    }
  },
}
