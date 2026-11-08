// ---------------------------------------------------------------------------
// FUENTE ÚNICA de permisos por página.
// La usan el menú (AppLayout.tsx), el guardián de rutas (App.tsx) y el simulador «Paso Maestro»,
// de modo que lo que se ve en el menú siempre coincide con lo que la página permite abrir.
// Si cambias lo que ve un rol, cámbialo AQUÍ. Cada página/RPC debe exigir lo mismo o menos.
// ---------------------------------------------------------------------------
import {
  canAccessCashAndAudit,
  canManageInventory,
  canManagePurchases,
  canManageSettings,
  canManageTeam,
  canManageTransport,
  canManageUsers,
  canRegisterSales,
  canViewAccounting,
  canViewDashboard,
  canViewStats,
  isCompanyManager,
} from './auth'
import type { Role } from '../types'

type Rule = (role?: Role) => boolean

/** Reglas de los roles de alcance ESTRICTO (solo ven estas páginas). */
const STRICT_ROLE_PAGES: Partial<Record<Role, string[]>> = {
  contador: ['accounting', 'accounting_puc', 'journal_entry', 'accstate'],
  // Vendedor (tienda o ruta): vende, consulta sus ventas, su ruta asignada, clientes, metas e inventario. NO maneja caja.
  vendedor: [
    'pos',
    'sales',
    'quotations',
    'catalog',
    'customers',
    'myroute',
    'map',
    'goals',
    'employee_portal',
    'products',
  ],
  gerente: ['stats', 'reports', 'profit', 'compliance', 'compliance_monitor', 'history', 'anomaly_detector'],
  transportador: ['warehouses', 'map', 'dispatch', 'routeplan', 'dispatch_history', 'equipment_assets'],
}

/** Reglas del resto de roles (dueño, admin empresa, almacén, compras, cajero, soporte...). */
const GENERIC_RULES: Record<string, Rule> = {
  myroute: role => role === 'vendedor',
  dashboard: role => canViewDashboard(role),
  command: role => isCompanyManager(role) || canViewAccounting(role),
  summary: role => role === 'admin' || role === 'dueno',
  copilot: role => true,
  ask: role => true,
  ai_actions: role => isCompanyManager(role),
  pos: role => canRegisterSales(role),
  omnichannel: role => canRegisterSales(role) || isCompanyManager(role),
  catalog: role => canRegisterSales(role),
  catorders: role => canRegisterSales(role) || isCompanyManager(role) || canViewAccounting(role),
  sales: role => canRegisterSales(role) || canViewAccounting(role),
  dispatch_history: role => canRegisterSales(role) || canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role),
  layaways: role => canRegisterSales(role),
  cartera: role => canRegisterSales(role) || canViewAccounting(role),
  quotations: role => canRegisterSales(role),
  customers: role => canRegisterSales(role) || canViewAccounting(role),
  devolutions: role => canRegisterSales(role),
  exchanges: role => canRegisterSales(role),
  sellers: role => canManageTeam(role) || canViewAccounting(role),
  employee_portal: role => canRegisterSales(role),
  routeplan: role => canManageTransport(role),
  dispatch: role => canManageTransport(role) || canManageInventory(role),
  goals: role => canRegisterSales(role) || isCompanyManager(role),
  purchaseorders: role => canManagePurchases(role) || canManageInventory(role) || canViewAccounting(role),
  purchases: role => isCompanyManager(role) || role === 'comprador' || canViewAccounting(role),
  payables: role => isCompanyManager(role),
  buyplan: role => isCompanyManager(role) || role === 'comprador',
  suppliers: role => isCompanyManager(role) || role === 'comprador',
  supplier_intel: role => isCompanyManager(role) || role === 'comprador',
  products: role => true,
  priceshield: role => isCompanyManager(role),
  blindcount: role => canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role),
  warehouses: role => canManageInventory(role),
  branch_balance: role => canManageInventory(role),
  equipment_assets: role => canManageInventory(role) || isCompanyManager(role),
  categories: role => canManageInventory(role),
  lots: role => canManageInventory(role),
  kardex: role => canManageInventory(role) || canManagePurchases(role) || canViewAccounting(role),
  labels: role => canManageInventory(role),
  treasury: role => isCompanyManager(role) || canViewAccounting(role),
  bankrecon: role => isCompanyManager(role) || canViewAccounting(role),
  cash: role => canAccessCashAndAudit(role),
  expenses: role => isCompanyManager(role) || canViewAccounting(role),
  anomaly_detector: role => canAccessCashAndAudit(role) || isCompanyManager(role),
  compliance: role => isCompanyManager(role) || canViewAccounting(role),
  reports: role => canViewStats(role),
  profit: role => isCompanyManager(role) || canViewAccounting(role),
  predict: role => canManageInventory(role) || canManagePurchases(role),
  stats: role => canViewStats(role),
  map: role => isCompanyManager(role) || canManageTransport(role),
  history: role => canAccessCashAndAudit(role),
  cpa: role => canViewAccounting(role),
  accounting: role => canViewAccounting(role),
  journal_entry: role => canViewAccounting(role),
  accstate: role => canViewAccounting(role),
  costcenters: role => isCompanyManager(role) || canViewAccounting(role),
  accsetup: role => canViewAccounting(role),
  accclose: role => canViewAccounting(role),
  taxes: role => canViewAccounting(role),
  erpbridge: role => isCompanyManager(role) || canViewAccounting(role),
  support: role => true,
  api_ecosystem: role => canManageSettings(role) || isCompanyManager(role),
  team: role => canManageTeam(role),
  users: role => canManageUsers(role),
  settings: role => canManageSettings(role),
  manual: role => true,
  accounting_puc: role => canViewAccounting(role),
  compliance_monitor: role => isCompanyManager(role) || canViewAccounting(role),
  despachos: role => canRegisterSales(role) || canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role),
  trazabilidad: role => canRegisterSales(role) || canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role),
  companies: role => role === 'admin' || (role as string) === 'super_admin',
  adminplans: role => role === 'admin' || (role as string) === 'super_admin',
  subscription: role => role === 'dueno' || role === 'admin' || (role as string) === 'super_admin',
}

export function isPageAllowedForRole(
  page: string,
  role?: Role,
  opts?: { isMasterAccount?: boolean; isDemo?: boolean; masterRoleOverride?: Role | null }
): boolean {
  const effectiveRole = opts?.masterRoleOverride || role
  // Centro de Scripts SQL y Supabase: solo Administrador Central; nunca roles de alcance estricto
  if (page === 'sqlcenter') {
    if (
      effectiveRole === 'contador' ||
      effectiveRole === 'gerente' ||
      effectiveRole === 'vendedor' ||
      effectiveRole === 'transportador' ||
      effectiveRole === 'cajero' ||
      effectiveRole === 'almacen' ||
      effectiveRole === 'comprador' ||
      effectiveRole === 'tecnico'
    ) {
      return false
    }
    return (
      (effectiveRole === 'admin' || (effectiveRole as string) === 'super_admin') &&
      (!opts?.masterRoleOverride || opts.masterRoleOverride === 'admin')
    )
  }
  const strict = effectiveRole ? STRICT_ROLE_PAGES[effectiveRole] : undefined
  if (strict) return strict.includes(page)
  const rule = GENERIC_RULES[page]
  return rule ? rule(effectiveRole) : true
}
