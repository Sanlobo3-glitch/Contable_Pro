import type { Role } from '../types'
import {
  isCompanyManager,
  canRegisterSales,
  canManageUsers,
  canManageTeam,
  canManageSettings,
  canViewStats,
  canManageInventory,
  canManagePurchases,
  canAccessCashAndAudit,
  canViewAccounting,
  canManageTransport,
} from './auth'

/**
 * Función central de autorización (Single Source of Truth).
 * Valida si un rol tiene permiso para visualizar o acceder a una página/módulo del sistema.
 */
export function isPageAllowedForRole(
  page: string,
  role?: Role,
  opts?: { isMasterAccount?: boolean; isDemo?: boolean; masterRoleOverride?: Role | null }
): boolean {
  // Si la cuenta maestra está simulando un rol específico en el Paso Maestro, aplicamos estrictamente ese rol
  const effectiveRole: Role | undefined = opts?.masterRoleOverride || role

  // REGLA 1: Centro de Scripts SQL y Supabase
  // SOLO el rol de Administrador Central ('super_admin' o 'admin') puede visualizarlo o ver sus rutas.
  // Queda ROTUNDAMENTE PROHIBIDO para Contador, Gerente, Vendedor, Transporte, Almacén, Cajero, etc.
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

  // REGLA 2: Rol 'Contador Público' ('contador')
  // Su acceso está estrictamente limitado a: Catálogo PUC NIIF, Registrar Asiento Diario y Centro de Estados Financieros (Balances).
  if (effectiveRole === 'contador') {
    return (
      page === 'accounting' ||
      page === 'accounting_puc' ||
      page === 'journal_entry' ||
      page === 'accstate'
    )
  }

  // REGLA 3: Rol 'Vendedor' ('vendedor')
  // Su acceso está enfocado en ventas y atención: Mostrador/POS, Inventario de Bodega, Cierre de Caja
  // y Clientes (onboarding con foto RIF/NIT, validación IA y observaciones).
  if (effectiveRole === 'vendedor') {
    return (
      page === 'pos' ||
      page === 'products' ||
      page === 'cash' ||
      page === 'customers' ||
      page === 'catalog' ||
      page === 'dispatch' ||
      page === 'routeplan' ||
      page === 'employee_portal'
    )
  }

  // REGLA 4: Rol 'Gerente' ('gerente')
  // Su acceso está estrictamente limitado a: analíticas, utilidades netas y auditoría de cumplimiento.
  if (effectiveRole === 'gerente') {
    return (
      page === 'stats' ||
      page === 'reports' ||
      page === 'profit' ||
      page === 'compliance' ||
      page === 'compliance_monitor' ||
      page === 'history' ||
      page === 'anomaly_detector'
    )
  }

  // REGLA 5: Rol 'Transporte y Despacho' ('transportador')
  // Su acceso está estrictamente limitado a operaciones logísticas:
  // Traslados multisede (bodegas, escáner, recepción), mapa satelital GPS en vivo, despacho de ruta, planificar rutas, trazabilidad y mantenimiento de flota.
  if (effectiveRole === 'transportador') {
    return (
      page === 'warehouses' ||
      page === 'map' ||
      page === 'dispatch' ||
      page === 'routeplan' ||
      page === 'dispatch_history' ||
      page === 'equipment_assets'
    )
  }

  // REGLA 6: Rol 'Cajero POS' ('cajero')
  if (effectiveRole === 'cajero') {
    return page === 'pos' || page === 'cash' || page === 'history'
  }

  // REGLA 7: Rol 'Almacén' ('almacen')
  if (effectiveRole === 'almacen') {
    return (
      page === 'products' ||
      page === 'warehouses' ||
      page === 'blindcount' ||
      page === 'lots' ||
      page === 'labels' ||
      page === 'purchaseorders' ||
      page === 'purchases' ||
      page === 'buyplan' ||
      page === 'predict' ||
      page === 'branch_balance' ||
      page === 'equipment_assets' ||
      page === 'kardex' ||
      page === 'categories'
    )
  }

  // REGLA 8: Rol 'Compras' ('comprador')
  if (effectiveRole === 'comprador') {
    return (
      page === 'purchaseorders' ||
      page === 'purchases' ||
      page === 'payables' ||
      page === 'buyplan' ||
      page === 'suppliers' ||
      page === 'supplier_intel'
    )
  }

  // REGLA 9: Rol 'Soporte Técnico' ('tecnico')
  if (effectiveRole === 'tecnico') {
    return page === 'support' || page === 'manual'
  }

  // REGLAS GENERALES PARA OTROS ROLES (Dueño, Admin Empresa, Administrador de Plataforma)
  switch (page) {
    case 'dashboard':
    case 'copilot':
    case 'ask':
    case 'ai_actions':
    case 'customers':
    case 'products':
    case 'catalog':
    case 'kardex':
    case 'manual':
      return true
    case 'command':
    case 'treasury':
    case 'bankrecon':
    case 'costcenters':
    case 'expenses':
    case 'profit':
      return isCompanyManager(effectiveRole) || canViewAccounting(effectiveRole)
    case 'summary':
      return isCompanyManager(effectiveRole) || canManageInventory(effectiveRole) || canViewAccounting(effectiveRole)
    case 'pos':
    case 'quotations':
    case 'layaways':
      return canRegisterSales(effectiveRole)
    case 'sales':
    case 'cartera':
      return canRegisterSales(effectiveRole) || canViewAccounting(effectiveRole)
    case 'catorders':
      return canRegisterSales(effectiveRole) || isCompanyManager(effectiveRole) || canViewAccounting(effectiveRole)
    case 'devolutions':
    case 'exchanges':
      return canRegisterSales(effectiveRole) || canManageInventory(effectiveRole)
    case 'sellers':
      return canManageTeam(effectiveRole) || canViewAccounting(effectiveRole)
    case 'employee_portal':
      return true
    case 'routeplan':
      return canRegisterSales(effectiveRole) || canManageTransport(effectiveRole)
    case 'dispatch':
      return canRegisterSales(effectiveRole) || canManageTransport(effectiveRole) || canManageInventory(effectiveRole)
    case 'goals':
      return canRegisterSales(effectiveRole) || isCompanyManager(effectiveRole)
    case 'purchaseorders':
      return canManagePurchases(effectiveRole) || canManageInventory(effectiveRole) || canViewAccounting(effectiveRole)
    case 'purchases':
    case 'payables':
      return canManagePurchases(effectiveRole) || canViewAccounting(effectiveRole)
    case 'buyplan':
    case 'suppliers':
    case 'predict':
      return canManagePurchases(effectiveRole) || canManageInventory(effectiveRole)
    case 'warehouses':
    case 'categories':
    case 'lots':
    case 'labels':
    case 'priceshield':
    case 'branch_balance':
    case 'equipment_assets':
      return canManageInventory(effectiveRole)
    case 'blindcount':
      return canManageInventory(effectiveRole) || canViewAccounting(effectiveRole) || isCompanyManager(effectiveRole)
    case 'cash':
    case 'history':
    case 'anomaly_detector':
      return canAccessCashAndAudit(effectiveRole)
    case 'compliance':
    case 'compliance_monitor':
      return isCompanyManager(effectiveRole) || canViewAccounting(effectiveRole)
    case 'reports':
    case 'stats':
      return canViewStats(effectiveRole)
    case 'map':
      return isCompanyManager(effectiveRole) || canManageTransport(effectiveRole)
    case 'accounting':
    case 'accounting_puc':
    case 'journal_entry':
    case 'accstate':
    case 'accsetup':
    case 'accclose':
    case 'taxes':
    case 'cpa':
      return canViewAccounting(effectiveRole)
    case 'erpbridge':
      return canViewAccounting(effectiveRole) || isCompanyManager(effectiveRole)
    case 'dispatch_history':
    case 'despachos':
    case 'trazabilidad':
    case 'support':
      return true
    case 'team':
      return canManageTeam(effectiveRole)
    case 'users':
      return canManageUsers(effectiveRole)
    case 'api_ecosystem':
      return canManageSettings(effectiveRole) || isCompanyManager(effectiveRole)
    case 'companies':
    case 'adminplans':
      return (
        (effectiveRole === 'admin' || (effectiveRole as string) === 'super_admin') &&
        (!opts?.masterRoleOverride || opts.masterRoleOverride === 'admin')
      )
    case 'subscription':
      return (
        (effectiveRole === 'dueno' || effectiveRole === 'admin' || (effectiveRole as string) === 'super_admin') &&
        (!opts?.masterRoleOverride || opts.masterRoleOverride === 'admin' || opts.masterRoleOverride === 'dueno')
      )
    case 'settings':
      return canManageSettings(effectiveRole)
    default:
      return true
  }
}
