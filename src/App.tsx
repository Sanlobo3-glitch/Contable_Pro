import { useEffect, useState } from 'react'
import {
  AuthProvider,
  useAuth,
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
} from './lib/auth'
import { useAppNavigation } from './lib/navigation'
import { getPublicStoreIdentifierFromLocation } from './lib/whatsappStudio'
import { WarehouseProvider } from './lib/warehouseContext'
import type { DemoRole } from './lib/supabase'
import Landing from './pages/Landing'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Terms from './pages/Terms'
import Privacy from './pages/Privacy'
import AppLayout from './components/AppLayout'
import Dashboard from './pages/Dashboard'
import Products from './pages/Products'
import BranchesWarehouses from './pages/BranchesWarehouses'
import Sales from './pages/Sales'
import Purchases from './pages/Purchases'
import PurchaseOrders from './pages/PurchaseOrders'
import Payables from './pages/Payables'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Cash from './pages/Cash'
import TreasuryForecast from './pages/TreasuryForecast'
import Expenses from './pages/Expenses'
import Devolutions from './pages/Devolutions'
import Kardex from './pages/Kardex'
import Categories from './pages/Categories'
import Quotations from './pages/Quotations'
import Reports from './pages/Reports'
import Stats from './pages/Stats'
import Subscription from './pages/Subscription'
import Users from './pages/Users'
import Settings from './pages/Settings'
import History from './pages/History'
import AdminPlans from './pages/AdminPlans'
import TeamDevices from './pages/TeamDevices'
import MapRoutes from './pages/MapRoutes'
import Accounting from './pages/Accounting'
import AccountingSetup from './pages/AccountingSetup'
import AccountingClose from './pages/AccountingClose'
import AccountingStatements from './pages/AccountingStatements'
import CostCenters from './pages/CostCenters'
import Goals from './pages/Goals'
import Taxes from './pages/Taxes'
import DianComplianceCenter from './pages/DianComplianceCenter'
import Mostrador from './pages/Mostrador'
import Labels from './pages/Labels'
import Manual from './pages/Manual'
import Copiloto from './pages/Copiloto'
import PurchaseSuggestions from './pages/PurchaseSuggestions'
import Cartera from './pages/Cartera'
import DailySummary from './pages/DailySummary'
import Predictions from './pages/Predictions'
import Profitability from './pages/Profitability'
import CommandCenter from './pages/CommandCenter'
import RoutePlanner from './pages/RoutePlanner'
import AskCopilot from './pages/AskCopilot'
import Lots from './pages/Lots'
import SellersPayroll from './pages/SellersPayroll'
import RouteDispatchPage from './pages/RouteDispatch'
import PublicCatalog from './pages/PublicCatalog'
import ProductCatalog from './pages/ProductCatalog'
import OmnichannelInbox from './pages/OmnichannelInbox'
import AiActionHub from './pages/AiActionHub'
import BranchRebalancing from './pages/BranchRebalancing'
import SupplierIntelligence from './pages/SupplierIntelligence'
import AnomalyDetector from './pages/AnomalyDetector'
import EquipmentAssets from './pages/EquipmentAssets'
import EmployeePortal from './pages/EmployeePortal'
import ComplianceMonitor from './pages/ComplianceMonitor'
import ApiEcosystem from './pages/ApiEcosystem'
import CatalogOrders from './pages/CatalogOrders'
import CompanyClients from './pages/CompanyClients'
import AccountantDesk from './pages/AccountantDesk'
import ErpBridge from './pages/ErpBridge'
import TechSupport from './pages/TechSupport'
import SqlAdminCenter from './pages/SqlAdminCenter'
import BlindInventory from './pages/BlindInventory'
import Layaways from './pages/Layaways'
import ExchangesWarranties from './pages/ExchangesWarranties'
import BankReconciliation from './pages/BankReconciliation'
import PriceShield from './pages/PriceShield'
import DispatchHistory from './pages/DispatchHistory'
import ManagerCenter from './pages/ManagerCenter'
import {
  registerDevice,
  touchDevice,
  type DeviceState,
} from './lib/devices'
import { useCurrency, refreshCurrency } from './lib/currency'
import CurrencySetup from './components/CurrencySetup'
import OnboardingWizard from './components/OnboardingWizard'
import type { Role } from './types'

function getPublicCatalogStoreKey(): string | null {
  return getPublicStoreIdentifierFromLocation()
}

function isPageAllowedForRole(
  page: string,
  role?: Role,
  opts?: { isMasterAccount?: boolean; isDemo?: boolean }
): boolean {
  // REGLA 1: Centro de Scripts SQL y Supabase
  // SOLO el rol de Administrador Central ('super_admin' o 'admin') puede visualizarlo o ver sus rutas.
  // Queda ROTUNDAMENTE PROHIBIDO mostrar este panel o el acceso a Supabase a los roles de Contador, Gerente, Vendedor o Transporte.
  if (page === 'sqlcenter') {
    if (role === 'contador' || role === 'gerente' || role === 'vendedor' || role === 'transportador') {
      return false
    }
    return role === 'admin' || (role as string) === 'super_admin'
  }

  // REGLA 2: Rol 'Contador Público' ('contador')
  // Su acceso está estrictamente limitado a: Catálogo PUC NIIF, Registrar Asiento Diario y Centro de Estados Financieros (Balances).
  if (role === 'contador') {
    return (
      page === 'accounting' ||
      page === 'accounting_puc' ||
      page === 'journal_entry' ||
      page === 'accstate' ||
      page === 'dian_compliance'
    )
  }

  // REGLA 3: Rol 'Vendedor' ('vendedor')
  // Su acceso está estrictamente limitado a: Mostrador/POS, Inventario de Bodega y Cierre de Caja.
  if (role === 'vendedor') {
    return page === 'pos' || page === 'products' || page === 'cash'
  }


  // REGLA 5: Rol 'Transporte y Despacho' ('transportador')
  // Su acceso está estrictamente limitado a operaciones logísticas:
  // Traslados multisede (bodegas, escáner, recepción), mapa satelital GPS en vivo, despacho de ruta, planificar rutas, trazabilidad y mantenimiento de flota.
  if (role === 'transportador') {
    return (
      page === 'warehouses' ||
      page === 'map' ||
      page === 'dispatch' ||
      page === 'routeplan' ||
      page === 'dispatch_history' ||
      page === 'equipment_assets'
    )
  }

  // REGLAS GENERALES PARA OTROS ROLES (Dueño, Admin Empresa, Jefe de Almacén, Soporte Técnico, etc.)
  switch (page) {
    case 'dashboard':
    case 'copilot':
    case 'ask':
    case 'customers':
    case 'products':
    case 'catalog':
    case 'kardex':
    case 'manual':
      return true
    case 'manager_center':
    case 'manager_summary':
    case 'manager_commercial':
    case 'manager_operations':
    case 'manager_financial':
    case 'manager_hr':
    case 'manager_authorizations':
    case 'manager_action_plans':
    case 'manager_intelligence':
    case 'manager_reports':
    case 'manager_notifications':
      return isCompanyManager(role)
    case 'command':
    case 'treasury':
    case 'bankrecon':
    case 'costcenters':
    case 'expenses':
    case 'profit':
      return isCompanyManager(role) || canViewAccounting(role)
    case 'summary':
      return isCompanyManager(role) || canManageInventory(role) || canViewAccounting(role)
    case 'pos':
    case 'quotations':
    case 'layaways':
      return canRegisterSales(role)
    case 'sales':
    case 'cartera':
      return canRegisterSales(role) || canViewAccounting(role)
    case 'catorders':
      return canRegisterSales(role) || isCompanyManager(role) || canViewAccounting(role)
    case 'devolutions':
    case 'exchanges':
      return canRegisterSales(role) || canManageInventory(role)
    case 'sellers':
      return canManageTeam(role) || canViewAccounting(role)
    case 'routeplan':
      return canRegisterSales(role) || canManageTransport(role)
    case 'dispatch':
      return canRegisterSales(role) || canManageTransport(role) || canManageInventory(role)
    case 'goals':
      return canRegisterSales(role) || isCompanyManager(role)
    case 'purchaseorders':
      return canManagePurchases(role) || canManageInventory(role) || canViewAccounting(role)
    case 'purchases':
    case 'payables':
      return canManagePurchases(role) || canViewAccounting(role)
    case 'buyplan':
    case 'suppliers':
    case 'predict':
      return canManagePurchases(role) || canManageInventory(role)
    case 'warehouses':
    case 'categories':
    case 'lots':
    case 'labels':
    case 'priceshield':
      return canManageInventory(role)
    case 'blindcount':
      return canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role)
    case 'cash':
    case 'history':
      return canAccessCashAndAudit(role)
    case 'reports':
    case 'stats':
      return canViewStats(role)
    case 'map':
      return isCompanyManager(role) || canManageTransport(role)
    case 'accounting':
    case 'accounting_puc':
    case 'journal_entry':
    case 'accstate':
    case 'accsetup':
    case 'accclose':
    case 'taxes':
    case 'dian_compliance':
    case 'cpa':
      return canViewAccounting(role) || isCompanyManager(role)
    case 'erpbridge':
      return canViewAccounting(role) || isCompanyManager(role)
    case 'dispatch_history':
    case 'despachos':
    case 'trazabilidad':
    case 'support':
      return true
    case 'team':
      return canManageTeam(role)
    case 'users':
      return canManageUsers(role)
    case 'companies':
    case 'adminplans':
      return role === 'admin' || (role as string) === 'super_admin'
    case 'subscription':
      return role === 'dueno' || role === 'admin' || (role as string) === 'super_admin'
    case 'settings':
      return canManageSettings(role)
    default:
      return true
  }
}

function AppContent() {
  const { user, loading, signOut, isDemo, isMasterAccount, enterDemo, exitDemo } = useAuth()
  const cur = useCurrency()

  const scopeKey = isDemo ? 'demo' : (user?.id ?? null)
  const defaultPageForRole =
    user?.role === 'gerente'
      ? 'manager_center'
      : user?.role === 'tecnico'
        ? 'support'
        : user?.role === 'contador'
          ? 'accounting'
          : user?.role === 'vendedor'
            ? 'pos'
            : user?.role === 'transportador'
              ? 'warehouses'
              : 'dashboard'

  const {
    current,
    previewCatalogId,
    authView,
    canGoBack,
    previousPageLabel,
    exitHintVisible,
    navigateToPage,
    openCatalogPreview,
    exitCatalogPreview,
    goBack,
    navigateAuthView,
    resetNavigationForLogout,
  } = useAppNavigation({
    isAuthenticated: Boolean(user),
    isLoading: loading,
    scopeKey,
    defaultPage: defaultPageForRole,
    isAllowedPage: page =>
      isPageAllowedForRole(page, user?.role, { isMasterAccount, isDemo }),
  })

  // Nunca iniciar una sesión como autorizada por defecto.
  const [dev, setDev] = useState<DeviceState>({
    status: 'verificando',
    enforced: true,
  })
  const [publicDemoCatalogOpen, setPublicDemoCatalogOpen] = useState(false)

  const publicCatalogId = getPublicCatalogStoreKey()

  // Verificación inicial de autorización del dispositivo.
  useEffect(() => {
    let active = true

    if (!user) {
      setDev({
        status: 'verificando',
        enforced: true,
      })

      return () => {
        active = false
      }
    }

    if (isDemo || isMasterAccount || user.role === 'tecnico') {
      setDev({
        status: 'autorizado',
        enforced: false,
      })

      return () => {
        active = false
      }
    }

    setDev({
      status: 'verificando',
      enforced: true,
    })

    registerDevice(user.id).then(result => {
      if (active) {
        setDev(result)
      }
    })

    return () => {
      active = false
    }
  }, [user?.id, user?.role, isDemo, isMasterAccount])

  // Mantiene actualizado el estado del dispositivo autorizado.
  useEffect(() => {
    if (!user || isDemo || dev.status !== 'autorizado') {
      return
    }

    let active = true
    let checking = false

    const checkDeviceHeartbeat = async () => {
      if (checking || !navigator.onLine) {
        return
      }

      checking = true

      try {
        const alive = await touchDevice()

        if (!active || alive === null) {
          return
        }

        if (alive === false) {
          const result = await registerDevice(user.id)

          if (active) {
            setDev(result)
          }
        }
      } catch {
        // No se bloquea una autorización previamente confirmada.
      } finally {
        checking = false
      }
    }

    const intervalId = window.setInterval(
      checkDeviceHeartbeat,
      60_000
    )

    window.addEventListener('online', checkDeviceHeartbeat)

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('online', checkDeviceHeartbeat)
    }
  }, [user?.id, isDemo, dev.status])

  async function retryDeviceVerification() {
    if (!user) return

    setDev({
      status: 'verificando',
      enforced: true,
    })

    const result = await registerDevice(user.id)

    setDev(result)
  }

  if (publicCatalogId) {
    return <PublicCatalog companyId={publicCatalogId} />
  }

  const path = window.location.pathname

  if (path === '/terminos') return <Terms />

  if (path === '/privacidad') return <Privacy />

  if (path === '/manual') {
    return <Manual standalone role={user?.role} />
  }

  const isResetPasswordPage =
    path === '/reset-password' ||
    window.location.hash.includes('type=recovery')

  if (isResetPasswordPage) return <ResetPassword />

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">Cargando...</div>
      </div>
    )
  }

  async function handleEnterDemo(targetPage = 'dashboard', role: DemoRole = 'dueno') {
    navigateToPage(targetPage, { resetStack: true })
    await enterDemo(role)
  }

  function handleExitDemoToAuth(target: 'login' | 'register') {
    resetNavigationForLogout(target)
    exitDemo()
  }

  async function handleSignOut() {
    resetNavigationForLogout('landing')
    if (isDemo) {
      exitDemo()
    } else {
      await signOut()
    }
  }

  if (!user) {
    if (publicDemoCatalogOpen) {
      return (
        <PublicCatalog
          companyId="00000000-0000-4000-8000-000000000001"
          onExitPreview={() => setPublicDemoCatalogOpen(false)}
        />
      )
    }

    if (authView === 'landing') {
      return (
        <Landing
          onLogin={() => navigateAuthView('login')}
          onRegister={() => navigateAuthView('register')}
          onEnterDemo={(page, role) => {
            void handleEnterDemo(page, role)
          }}
          onOpenDemoCatalog={() => setPublicDemoCatalogOpen(true)}
        />
      )
    }

    return (
      <Login
        initialMode={authView === 'register' ? 'register' : 'login'}
        onBack={() => navigateAuthView('landing')}
        onEnterDemo={(page, role) => {
          void handleEnterDemo(page, role)
        }}
      />
    )
  }

  if (dev.status === 'verificando') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />

          <h1 className="text-lg font-bold text-slate-800">
            Verificando dispositivo
          </h1>

          <p className="mt-2 text-sm text-slate-500">
            Estamos comprobando que este equipo esté autorizado por tu empresa.
          </p>
        </div>
      </div>
    )
  }

  if (dev.status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-bold text-slate-800">
            No se pudo verificar el dispositivo
          </h1>

          <p className="text-sm text-slate-500 mt-2">
            Por seguridad, Inventario Pro no habilitará las operaciones
            hasta confirmar la autorización de este equipo.
          </p>

          {dev.message && (
            <p className="text-xs text-red-600 mt-2 break-words">
              {dev.message}
            </p>
          )}

          <div className="mt-4 flex gap-2 justify-center">
            <button
              onClick={retryDeviceVerification}
              className="bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Reintentar
            </button>

            <button
              onClick={() => void handleSignOut()}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (dev.status === 'bloqueado') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-bold text-slate-800">
            Dispositivo bloqueado
          </h1>

          <p className="text-sm text-slate-500 mt-2">
            El administrador de tu empresa bloqueó este dispositivo.
            Contáctalo para recuperar el acceso.
          </p>

          <button
            onClick={() => void handleSignOut()}
            className="mt-4 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Cerrar sesión
          </button>
        </div>
      </div>
    )
  }

  if (
    dev.enforced &&
    dev.status === 'pendiente' &&
    !isCompanyManager(user.role) &&
    !isMasterAccount &&
    user.role !== 'tecnico'
  ) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-bold text-slate-800">
            Dispositivo pendiente de autorización
          </h1>

          <p className="text-sm text-slate-500 mt-2">
            Pide al administrador de tu empresa que autorice este dispositivo
            y luego pulsa «Ya lo autorizaron».
          </p>

          <div className="mt-4 flex gap-2 justify-center">
            <button
              onClick={retryDeviceVerification}
              className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium"
            >
              Ya lo autorizaron
            </button>

            <button
              onClick={() => void handleSignOut()}
              className="px-4 py-2 rounded-lg text-sm text-slate-600 border border-slate-200"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (user.role === 'dueno' && cur.confirmed === false && !isMasterAccount) {
    return <OnboardingWizard onComplete={() => refreshCurrency()} />
  }

  if (previewCatalogId) {
    return (
      <PublicCatalog
        companyId={previewCatalogId}
        onExitPreview={exitCatalogPreview}
        onOpenCatalogOrders={() => {
          exitCatalogPreview()
          navigateToPage('catorders')
        }}
      />
    )
  }

  const safeCurrent = isPageAllowedForRole(current, user.role, {
    isMasterAccount,
    isDemo,
  })
    ? current
    : defaultPageForRole

  const pages: Record<string, React.ReactNode> = {
    manager_center: <ManagerCenter key="manager_center" pageId="manager_center" onNavigate={navigateToPage} initialTab="resumen" />,
    manager_summary: <ManagerCenter key="manager_summary" pageId="manager_summary" onNavigate={navigateToPage} initialTab="resumen" />,
    manager_commercial: <ManagerCenter key="manager_commercial" pageId="manager_commercial" onNavigate={navigateToPage} initialTab="comercial" />,
    manager_operations: <ManagerCenter key="manager_operations" pageId="manager_operations" onNavigate={navigateToPage} initialTab="operaciones" />,
    manager_financial: <ManagerCenter key="manager_financial" pageId="manager_financial" onNavigate={navigateToPage} initialTab="financiera" />,
    manager_hr: <ManagerCenter key="manager_hr" pageId="manager_hr" onNavigate={navigateToPage} initialTab="talento" />,
    manager_authorizations: <ManagerCenter key="manager_authorizations" pageId="manager_authorizations" onNavigate={navigateToPage} initialTab="autorizaciones" />,
    manager_action_plans: <ManagerCenter key="manager_action_plans" pageId="manager_action_plans" onNavigate={navigateToPage} initialTab="planes" />,
    manager_intelligence: <ManagerCenter key="manager_intelligence" pageId="manager_intelligence" onNavigate={navigateToPage} initialTab="inteligencia" />,
    manager_reports: <ManagerCenter key="manager_reports" pageId="manager_reports" onNavigate={navigateToPage} initialTab="informes" />,
    manager_notifications: <ManagerCenter key="manager_notifications" pageId="manager_notifications" onNavigate={navigateToPage} initialTab="notificaciones" />,
    dashboard: <Dashboard onNavigate={navigateToPage} />,
    products: <Products onPreviewCatalog={openCatalogPreview} onNavigate={navigateToPage} />,
    catalog: <ProductCatalog onNavigate={navigateToPage} onPreviewCatalog={openCatalogPreview} />,
    catorders: <CatalogOrders onNavigate={navigateToPage} onPreviewCatalog={openCatalogPreview} />,
    warehouses: <BranchesWarehouses onNavigate={navigateToPage} />,
    sales: <Sales />,
    purchases: <Purchases onNavigate={navigateToPage} />,
    purchaseorders: <PurchaseOrders onNavigate={navigateToPage} />,
    payables: <Payables />,
    customers: <Customers />,
    suppliers: <Suppliers />,
    cash: <Cash onNavigate={navigateToPage} />,
    treasury: <TreasuryForecast onNavigate={navigateToPage} />,
    bankrecon: <BankReconciliation onNavigate={navigateToPage} />,
    expenses: <Expenses />,
    devolutions: <Devolutions onNavigate={navigateToPage} />,
    exchanges: <ExchangesWarranties onNavigate={navigateToPage} />,
    layaways: <Layaways onNavigate={navigateToPage} />,
    blindcount: <BlindInventory onNavigate={navigateToPage} />,
    priceshield: <PriceShield onNavigate={navigateToPage} />,
    kardex: <Kardex />,
    categories: <Categories />,
    quotations: <Quotations />,
    reports: <Reports />,
    stats: <Stats onNavigate={navigateToPage} />,
    subscription: <Subscription />,
    users: <Users />,
    settings: <Settings />,
    history: <History />,
    adminplans: <AdminPlans />,
    companies: <CompanyClients onNavigate={navigateToPage} />,
    team: <TeamDevices onNavigate={navigateToPage} />,
    sellers: <SellersPayroll onNavigate={navigateToPage} />,
    map: <MapRoutes />,
    cpa: <AccountantDesk onNavigate={navigateToPage} />,
    accounting: <Accounting onNavigate={navigateToPage} />,
    accounting_puc: <Accounting initialTab="accounts" onNavigate={navigateToPage} />,
    journal_entry: <Accounting initialTab="journal" autoOpenNewEntry={true} onNavigate={navigateToPage} />,
    erpbridge: <ErpBridge onNavigate={navigateToPage} />,
    accsetup: <AccountingSetup />,
    accclose: <AccountingClose />,
    accstate: <AccountingStatements onNavigate={navigateToPage} />,
    costcenters: <CostCenters onNavigate={navigateToPage} />,
    goals: <Goals />,
    taxes: <Taxes />,
    dian_compliance: <DianComplianceCenter onNavigate={navigateToPage} />,
    pos: <Mostrador onNavigate={navigateToPage} />,
    labels: <Labels />,
    copilot: <Copiloto onNavigate={navigateToPage} />,
    buyplan: <PurchaseSuggestions onNavigate={navigateToPage} />,
    cartera: <Cartera />,
    summary: <DailySummary />,
    predict: <Predictions onNavigate={navigateToPage} />,
    profit: <Profitability />,
    command: <CommandCenter onNavigate={navigateToPage} />,
    routeplan: <RoutePlanner onNavigate={navigateToPage} />,
    dispatch: <RouteDispatchPage onNavigate={navigateToPage} />,
    dispatch_history: <DispatchHistory onNavigate={navigateToPage} />,
    despachos: <DispatchHistory onNavigate={navigateToPage} />,
    trazabilidad: <DispatchHistory onNavigate={navigateToPage} />,
    ask: <AskCopilot onNavigate={navigateToPage} />,
    lots: <Lots onNavigate={navigateToPage} />,
    support: <TechSupport currentOriginPage={safeCurrent} onNavigate={navigateToPage} />,
    sqlcenter: <SqlAdminCenter />,
    manual: <Manual role={user.role} onNavigate={navigateToPage} />,
    omnichannel: <OmnichannelInbox onNavigate={navigateToPage} />,
    omnichannel_inbox: <OmnichannelInbox onNavigate={navigateToPage} />,
    ai_actions: <AiActionHub onNavigate={navigateToPage} />,
    ai_action_hub: <AiActionHub onNavigate={navigateToPage} />,
    branch_balance: <BranchRebalancing onNavigate={navigateToPage} />,
    branch_rebalancing: <BranchRebalancing onNavigate={navigateToPage} />,
    supplier_intel: <SupplierIntelligence onNavigate={navigateToPage} />,
    anomaly_detector: <AnomalyDetector onNavigate={navigateToPage} />,
    equipment_assets: <EquipmentAssets onNavigate={navigateToPage} />,
    employee_portal: <EmployeePortal onNavigate={navigateToPage} />,
    compliance: <ComplianceMonitor onNavigate={navigateToPage} />,
    compliance_monitor: <ComplianceMonitor onNavigate={navigateToPage} />,
    api_ecosystem: <ApiEcosystem onNavigate={navigateToPage} />,
  }

  return (
    <AppLayout
      current={safeCurrent}
      onNavigate={navigateToPage}
      canGoBack={canGoBack}
      previousPageLabel={previousPageLabel}
      onGoBack={goBack}
      exitHintVisible={exitHintVisible}
      onSignOut={() => void handleSignOut()}
      onExitDemoToLogin={() => handleExitDemoToAuth('login')}
      onExitDemoToRegister={() => handleExitDemoToAuth('register')}
    >
      {pages[safeCurrent] ?? <Dashboard onNavigate={navigateToPage} />}
    </AppLayout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <WarehouseProvider>
        <AppContent />
      </WarehouseProvider>
    </AuthProvider>
  )
}
