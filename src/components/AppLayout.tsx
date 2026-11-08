import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useInstall } from '../lib/install'
import { syncQueue } from '../lib/offlineQueue'
import { startCopilot, stopCopilot, useCopilot, pendingCount } from '../lib/copilot'
import {
  useAuth,
  getRoleLabel,
  MASTER_DEV_EMAIL,
  MASTER_SWITCHABLE_ROLES,
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
  canManageTechSupport,
  getTrialDaysLeft,
  isTrialActive,
  isSubscriptionActive,
} from '../lib/auth'
import { supabase, type DemoRole } from '../lib/supabase'
import { useCurrency, refreshCurrency } from '../lib/currency'
import { useWarehouse } from '../lib/warehouseContext'
import AvatarCapture, { UserAvatar } from './AvatarCapture'
import CommandPalette, { type PaletteItem } from './CommandPalette'
import { useBackOverlay } from '../lib/navigation'
import type { CompanySummary, Role } from '../types'
import {
  ArrowLeft,
  ArrowLeftRight,
  Plus,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  LogOut,
  Menu,
  Wallet,
  Truck,
  Undo2,
  BarChart3,
  UserCog,
  X,
  ClipboardList,
  Tag,
  FileText,
  Settings as SettingsIcon,
  FileBarChart,
  CreditCard,
  Clock,
  AlertTriangle,
  History,
  Gift,
  MonitorSmartphone,
  MapPin,
  BookOpen,
  Download,
  Target,
  Percent,
  Store,
  QrCode,
  HelpCircle,
  Lock,
  Sparkles,
  Bell,
  ShoppingBasket,
  Banknote,
  CalendarDays,
  MessageCircleQuestion,
  CalendarClock,
  TrendingUp,
  TrendingDown,
  PieChart,
  Gauge,
  Route as RouteIcon,
  Receipt,
  Search,
  BadgeCheck,
  Camera,
  Building2,
  ChevronDown,
  ChevronRight,
  Warehouse as WarehouseIcon,
  ClipboardCheck,
  Landmark,
  Layers,
  Calculator,
  LifeBuoy,
  KeyRound,
  RotateCcw,
  Database,
  EyeOff,
  ShieldCheck,
  FileSpreadsheet,
  Boxes,
  Wrench,
  Award,
  Scale,
  ShieldAlert,
  Code,
  UserCheck,
} from 'lucide-react'
import { getActiveSupportPass, revokeSupportPass } from '../lib/innovationsRepo'

interface NavItem {
  id: string
  label: string
  section: string
  keywords?: string
  icon: ReactNode
  allowed: boolean
}

const DEMO_ROLES: { id: DemoRole; label: string }[] = [
  { id: 'dueno', label: 'Dueño' },
  { id: 'admin_empresa', label: 'Admin. Empresa' },
  { id: 'gerente', label: 'Gerente' },
  { id: 'contador', label: 'Contador Público' },
  { id: 'almacen', label: 'Almacén' },
  { id: 'vendedor', label: 'Vendedor' },
  { id: 'transportador', label: 'Transporte' },
  { id: 'tecnico', label: 'Soporte Técnico' },
]

export default function AppLayout({
  current,
  onNavigate,
  canGoBack = false,
  previousPageLabel = null,
  onGoBack,
  exitHintVisible = false,
  onSignOut,
  onExitDemoToLogin,
  onExitDemoToRegister,
  children,
}: {
  current: string
  onNavigate: (id: string) => void
  canGoBack?: boolean
  previousPageLabel?: string | null
  onGoBack?: () => void
  exitHintVisible?: boolean
  onSignOut?: () => void
  onExitDemoToLogin?: () => void
  onExitDemoToRegister?: () => void
  children: ReactNode
}) {
  const {
    user,
    signOut,
    refreshUser,
    inviteNotice,
    clearInviteNotice,
    isDemo,
    demoRole,
    isMasterAccount,
    realRole,
    masterRoleOverride,
    masterCompanyOverride,
    switchMasterRole,
    switchDemoRole,
    resetDemo,
    exitDemo,
  } = useAuth()
  const cur = useCurrency()
  const { activeWarehouses, activeWarehouseId, activeWarehouse, activeBranch, setActiveWarehouseId, refreshWarehouses } = useWarehouse()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [navSearch, setNavSearch] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null)
  const [demoResetDone, setDemoResetDone] = useState(false)
  const [masterCompanies, setMasterCompanies] = useState<CompanySummary[]>([])
  const [myForm, setMyForm] = useState({
    full_name: '',
    avatar_url: null as string | null,
    national_id: '',
    phone: '',
    address: '',
    emergency_contact: '',
  })

  const { canInstall, install } = useInstall()
  const cp = useCopilot()
  const alertCount = pendingCount(cp)

  // En móvil/navegador, si el menú lateral, el buscador rápido o el modal de perfil están abiertos,
  // presionar «Atrás» cierra primero el cajón/modal sin abandonar el módulo actual.
  useBackOverlay(
    mobileOpen || paletteOpen || (profileModalOpen && !savingProfile),
    () => {
      setProfileModalOpen(false)
      setPaletteOpen(false)
      setMobileOpen(false)
    }
  )

  const [activeSupportPass, setActiveSupportPass] = useState(getActiveSupportPass())

  const handleRevokePass = () => {
    revokeSupportPass()
    setActiveSupportPass(null)
  }

  const handleLogoutAction = () => {
    if (onSignOut) {
      onSignOut()
    } else if (isDemo) {
      exitDemo()
    } else {
      void signOut()
    }
  }

  // Atajo global Ctrl+K / Cmd+K para paleta de comandos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(p => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Copiloto: revisa el negocio al entrar y se actualiza solo.
  useEffect(() => {
    const id = user?.id
    if (!id) return
    const stop = startCopilot(id)
    return () => {
      stop()
      stopCopilot()
    }
  }, [user?.id])

  // Envío automático de lo guardado sin señal.
  useEffect(() => {
    const id = user?.id
    if (!id) return
    const run = () => {
      if (navigator.onLine) syncQueue(id)
    }
    run()
    window.addEventListener('online', run)
    const timer = window.setInterval(run, 45000)
    return () => {
      window.removeEventListener('online', run)
      window.clearInterval(timer)
    }
  }, [user?.id])

  // Exclusivo cuenta maestra (sanlobo3@hotmail.com): carga directorio de empresas para cambio de contexto
  useEffect(() => {
    let active = true
    if (!isMasterAccount || isDemo) {
      setMasterCompanies([])
      return
    }
    supabase.rpc('admin_listar_empresas').then(({ data, error }) => {
      if (!active || error || !Array.isArray(data)) return
      setMasterCompanies(data as CompanySummary[])
    })
    return () => {
      active = false
    }
  }, [isMasterAccount, isDemo])

  function openMyProfileModal() {
    if (!user) return
    setProfileFeedback(null)
    setMyForm({
      full_name: user.full_name || '',
      avatar_url: user.avatar_url || null,
      national_id: user.national_id || '',
      phone: user.phone || '',
      address: user.address || '',
      emergency_contact: user.emergency_contact || '',
    })
    setMobileOpen(false)
    setProfileModalOpen(true)
  }

  async function handleSaveMyProfile(e: React.FormEvent) {
    e.preventDefault()
    if (!user) return

    setSavingProfile(true)
    setProfileFeedback(null)

    const { error } = await supabase.rpc('guardar_mi_perfil', {
      p_full_name: myForm.full_name.trim() || null,
      p_avatar_url: myForm.avatar_url || null,
      p_national_id: myForm.national_id.trim() || null,
      p_phone: myForm.phone.trim() || null,
      p_address: myForm.address.trim() || null,
      p_emergency_contact: myForm.emergency_contact.trim() || null,
    })

    setSavingProfile(false)

    if (error) {
      setProfileFeedback(
        /guardar_mi_perfil|does not exist|schema cache/i.test(error.message || '')
          ? 'Pide al administrador ejecutar en Supabase el script SQL 20261101_vendedores_nomina_invitaciones_usuarios.sql para guardar fotos y datos personales.'
          : error.message
      )
      return
    }

    await refreshUser()
    setProfileModalOpen(false)
  }

  const role = user?.role
  // REGLA 1: Administrador Central estricto ('super_admin' o 'admin' de plataforma)
  // SOLO el rol de Administrador Central puede visualizarlo.
  // Queda rotundamente prohibido para Contador, Gerente, Vendedor, Transporte, etc.
  const isSimulatingNonAdmin = Boolean(masterRoleOverride && masterRoleOverride !== 'admin')
  const isSuperAdmin =
    !isSimulatingNonAdmin &&
    (role === 'admin' || (role as string) === 'super_admin' || (isMasterAccount && !masterRoleOverride)) &&
    !['contador', 'gerente', 'vendedor', 'transportador', 'cajero', 'almacen', 'comprador', 'tecnico', 'dueno', 'admin_empresa'].includes(role || '')
  const isCompanyOwner = role === 'dueno'

  const navItems: NavItem[] = useMemo(() => {
    // ------------------------------------------------------------------------
    // REGLA 2: Si el usuario tiene el rol 'Contador Público' ('contador')
    // Su barra de navegación SOLO debe mostrar:
    // 1. Catálogo PUC NIIF
    // 2. Registrar Asiento Diario
    // 3. Centro de Estados Financieros (Balances)
    // ------------------------------------------------------------------------
    if (role === 'contador') {
      return [
        {
          id: 'accounting',
          label: 'Catálogo PUC NIIF',
          section: 'Contabilidad NIIF',
          keywords: 'puc catalogo cuentas niif partida doble plan cuentas maestro',
          icon: <BookOpen className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'journal_entry',
          label: 'Registrar Asiento Diario',
          section: 'Contabilidad NIIF',
          keywords: 'asiento diario partida doble comprobante registrar nuevo debito credito',
          icon: <Plus className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'accstate',
          label: 'Centro de Estados Financieros (Balances)',
          section: 'Contabilidad NIIF',
          keywords: 'estados financieros balance general pyg comprobacion perdidas ganancias situacion financiera',
          icon: <FileBarChart className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
      ]
    }

    // ------------------------------------------------------------------------
    // REGLA 3: Si el usuario es 'Vendedor' ('vendedor')
    // Su menú debe estar estrictamente limitado a:
    // 1. Mostrador/POS
    // 2. Inventario de Bodega
    // 3. Cierre de Caja
    // ------------------------------------------------------------------------
    if (role === 'vendedor') {
      return [
        {
          id: 'pos',
          label: 'Mostrador/POS',
          section: 'Operaciones de Venta',
          keywords: 'mostrador pos caja rapida cobrar facturar ticket venta directa',
          icon: <Store className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'products',
          label: 'Inventario de Bodega',
          section: 'Operaciones de Venta',
          keywords: 'inventario de bodega productos stock sku existencias mercancia articulos',
          icon: <Package className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'cash',
          label: 'Cierre de Caja',
          section: 'Operaciones de Venta',
          keywords: 'cierre de caja arqueo efectivo corte turno saldo billetes monedas',
          icon: <Wallet className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
      ]
    }

    // ------------------------------------------------------------------------
    // REGLA 5: Si el usuario es 'Transporte y Despacho' ('transportador')
    // Su menú debe estar estrictamente enfocado en su operación logística:
    // 1. Traslados y Despacho Multisede (Bodegas, escáner en sitio, fotos/firmas, remisiones)
    // 2. Mapa y Rutas GPS en Vivo (Monitoreo satelital, simulación y reproductor de historial)
    // 3. Despacho de Ruta (Hoja de carga, entregas presenciales)
    // 4. Planificar Rutas (Itinerario y optimización de visitas)
    // 5. Trazabilidad y Auditoría de Despachos (Historial producto/cliente/tienda, correcciones)
    // 6. Vehículos y Mantenimiento de Flota (Estado de camiones, SOAT, odómetro, conductores)
    // ------------------------------------------------------------------------
    if (role === 'transportador') {
      return [
        {
          id: 'warehouses',
          label: 'Traslados y Despacho Multisede',
          section: 'Operaciones de Transporte',
          keywords: 'traslados multibodega despacho escaner qr remision firma entrega vehiculos recepcion en sitio',
          icon: <Building2 className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'map',
          label: 'Mapa y Rutas GPS en Vivo',
          section: 'Operaciones de Transporte',
          keywords: 'mapa rutas gps telemetria vehiculos vivo historial reproductor conductor satelital velocidad',
          icon: <MapPin className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'dispatch',
          label: 'Despacho de Ruta',
          section: 'Operaciones de Transporte',
          keywords: 'despacho hoja de ruta entregas transportador camion carga liquidacion',
          icon: <Truck className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'routeplan',
          label: 'Planificar Rutas',
          section: 'Operaciones de Transporte',
          keywords: 'planificar rutas paradas optimizacion visitas entregas clientes',
          icon: <RouteIcon className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'dispatch_history',
          label: 'Trazabilidad y Auditoría Despachos',
          section: 'Operaciones de Transporte',
          keywords: 'trazabilidad auditoria despachos quien movio corrigio cantidades faltante producto cliente tienda',
          icon: <History className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
        {
          id: 'equipment_assets',
          label: 'Vehículos y Mantenimiento Flota',
          section: 'Operaciones de Transporte',
          keywords: 'vehiculos camiones flota mantenimiento preventivo soat tecnicomecanica odometro conductor',
          icon: <Wrench className="w-4 h-4 shrink-0" />,
          allowed: true,
        },
      ]
    }

    // ------------------------------------------------------------------------
    // OTROS ROLES (Administrador Central / Super Admin, Dueño, Almacén, Soporte Técnico, etc.)
    // ------------------------------------------------------------------------
    return [
      // Inicio y mando
      { id: 'dashboard', label: 'Panel ejecutivo', section: 'Principal', keywords: 'inicio kpi resumen', icon: <LayoutDashboard className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'command', label: 'Centro de mando', section: 'Principal', keywords: 'cfo coo finanzas vivo pulso sedes', icon: <Gauge className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'summary', label: 'Resumen del día', section: 'Principal', keywords: 'cierre diario corte', icon: <CalendarDays className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canManageInventory(role) || canViewAccounting(role) },
      { id: 'copilot', label: 'Copiloto', section: 'Principal', keywords: 'alertas avisos', icon: <Sparkles className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'ask', label: 'Pregúntale al Copiloto', section: 'Principal', keywords: 'asistente consulta', icon: <MessageCircleQuestion className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'ai_actions', label: 'Acciones de IA (Aprobaciones)', section: 'Principal', keywords: 'ia human in the loop aprobacion sugerencias ordenes compra precios', icon: <Sparkles className="w-4 h-4 shrink-0" />, allowed: true },

      // Ventas y cobros
      { id: 'pos', label: 'Mostrador (POS)', section: 'Ventas y cobros', keywords: 'caja rapida cobrar facturar', icon: <Store className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) },
      { id: 'omnichannel', label: 'Pedidos omnicanal', section: 'Ventas y cobros', keywords: 'pedidos whatsapp catalogo web ruta omnicanal alistamiento empaque epod', icon: <Boxes className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || isCompanyManager(role) },
      { id: 'catalog', label: 'Catálogo comercial', section: 'Ventas y cobros', keywords: 'catalogo pdf whatsapp fotos precios lista vendedor vitrina compartir', icon: <BookOpen className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'catorders', label: 'Pedidos de catálogo', section: 'Ventas y cobros', keywords: 'pedidos catalogo web capture comprobante pagomovil nequi zelle verificar autogestion', icon: <ClipboardCheck className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || isCompanyManager(role) || canViewAccounting(role) },
      { id: 'sales', label: 'Ventas', section: 'Ventas y cobros', keywords: 'facturas historial ventas', icon: <ShoppingCart className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canViewAccounting(role) },
      { id: 'dispatch_history', label: 'Trazabilidad y despachos', section: 'Ventas y cobros', keywords: 'despachos trazabilidad producto cliente tienda sucursal historial imprimir reporte remisiones salidas auditar', icon: <History className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role) },
      { id: 'layaways', label: 'Plan Separe y apartados', section: 'Ventas y cobros', keywords: 'plan separe apartados anticipos abonos reservar mercancia whatsapp', icon: <CalendarClock className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) },
      { id: 'cartera', label: 'Cartera (fiado)', section: 'Ventas y cobros', keywords: 'cxc cuentas por cobrar abonos deudores', icon: <Banknote className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canViewAccounting(role) },
      { id: 'quotations', label: 'Cotizaciones', section: 'Ventas y cobros', keywords: 'presupuestos proformas', icon: <FileText className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) },
      { id: 'customers', label: 'Clientes', section: 'Ventas y cobros', keywords: 'directorio compradores', icon: <Users className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'devolutions', label: 'Devoluciones', section: 'Ventas y cobros', keywords: 'notas credito garantias', icon: <Undo2 className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canManageInventory(role) },
      { id: 'exchanges', label: 'Cambios y garantías', section: 'Ventas y cobros', keywords: 'cambios mano a mano talla referencia excedente garantias posventa', icon: <ArrowLeftRight className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canManageInventory(role) },
      { id: 'sellers', label: 'Equipo y nómina', section: 'Ventas y cobros', keywords: 'vendedores comisiones vales pagos', icon: <BadgeCheck className="w-4 h-4 shrink-0" />, allowed: canManageTeam(role) || canViewAccounting(role) },
      { id: 'employee_portal', label: 'Portal de vendedor', section: 'Ventas y cobros', keywords: 'autoservicio comisiones metas vendedor cartera saldo', icon: <UserCheck className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'routeplan', label: 'Planificar rutas', section: 'Ventas y cobros', keywords: 'paradas visitas', icon: <RouteIcon className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canManageTransport(role) },
      { id: 'dispatch', label: 'Despacho de ruta', section: 'Ventas y cobros', keywords: 'camion liquidacion carga', icon: <Truck className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || canManageTransport(role) || canManageInventory(role) },
      { id: 'goals', label: 'Metas', section: 'Ventas y cobros', keywords: 'objetivos cuotas', icon: <Target className="w-4 h-4 shrink-0" />, allowed: canRegisterSales(role) || isCompanyManager(role) },

      // Compras y obligaciones
      { id: 'purchaseorders', label: 'Órdenes de compra', section: 'Compras y pagos', keywords: 'oc pedidos proveedor recepcion bodega backorder', icon: <ClipboardCheck className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canManageInventory(role) || canViewAccounting(role) },
      { id: 'purchases', label: 'Compras', section: 'Compras y pagos', keywords: 'entradas mercancia facturas compra', icon: <Truck className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canViewAccounting(role) },
      { id: 'payables', label: 'Cuentas por pagar', section: 'Compras y pagos', keywords: 'cxp deuda proveedores pagos', icon: <Receipt className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canViewAccounting(role) },
      { id: 'buyplan', label: 'Sugerencia de compras', section: 'Compras y pagos', keywords: 'reabastecimiento reposicion', icon: <ShoppingBasket className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canManageInventory(role) },
      { id: 'suppliers', label: 'Proveedores', section: 'Compras y pagos', keywords: 'fabricantes distribuidores', icon: <Truck className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canManageInventory(role) },
      { id: 'supplier_intel', label: 'Evaluación proveedores', section: 'Compras y pagos', keywords: 'otif inflacion costos ranking compras demoras calidad', icon: <Award className="w-4 h-4 shrink-0" />, allowed: canManagePurchases(role) || canManageInventory(role) },

      // Inventario y sedes
      { id: 'products', label: 'Productos', section: 'Inventario', keywords: 'catalogo precios stock sku', icon: <Package className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'priceshield', label: 'Escudo de precios', section: 'Inventario', keywords: 'escudo margenes actualizar precios masivo redondeo inflacion etiquetas', icon: <ShieldCheck className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },
      { id: 'blindcount', label: 'Toma física ciega', section: 'Inventario', keywords: 'toma fisica ciega conteo auditoria faltantes sobrantes inventario', icon: <EyeOff className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) || canViewAccounting(role) || isCompanyManager(role) },
      { id: 'warehouses', label: 'Sedes y multibodega', section: 'Inventario', keywords: 'sucursales bodegas almacenes traslados reservas', icon: <Building2 className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },
      { id: 'branch_balance', label: 'Balanceo de sedes', section: 'Inventario', keywords: 'traslado predictivo bodegas sobrestock stockout rebalanceo', icon: <ArrowLeftRight className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },
      { id: 'equipment_assets', label: 'Activos y maquinaria', section: 'Inventario', keywords: 'vehiculo bascula balanza nevera mantenimiento preventivo equipos flota', icon: <Wrench className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) || isCompanyManager(role) },
      { id: 'categories', label: 'Categorías', section: 'Inventario', keywords: 'lineas familias', icon: <Tag className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },
      { id: 'lots', label: 'Lotes y vencimientos', section: 'Inventario', keywords: 'caducidad fefo perecederos', icon: <CalendarClock className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },
      { id: 'kardex', label: 'Kardex', section: 'Inventario', keywords: 'movimientos auditoria entradas salidas', icon: <ClipboardList className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'labels', label: 'Etiquetas', section: 'Inventario', keywords: 'codigos barras qr impresion', icon: <QrCode className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) },

      // Caja, tesorería y gastos
      { id: 'treasury', label: 'Tesorería y presupuesto', section: 'Caja y gastos', keywords: 'flujo caja liquidez proyeccion 30 60 90 presupuesto cfo', icon: <Landmark className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'bankrecon', label: 'Conciliación bancaria', section: 'Caja y gastos', keywords: 'conciliacion bancaria extracto nequi bancolombia 4x1000 gmf comisiones banco', icon: <FileSpreadsheet className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'cash', label: 'Caja y arqueos', section: 'Caja y gastos', keywords: 'efectivo apertura cierre turno', icon: <Wallet className="w-4 h-4 shrink-0" />, allowed: canAccessCashAndAudit(role) },
      { id: 'expenses', label: 'Gastos operativos', section: 'Caja y gastos', keywords: 'egresos servicios alquiler', icon: <TrendingDown className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'anomaly_detector', label: 'Detección de anomalías', section: 'Caja y gastos', keywords: 'fraude mermas descuentos caja devolucion auditoria perdida riesgo', icon: <ShieldAlert className="w-4 h-4 shrink-0" />, allowed: canAccessCashAndAudit(role) || isCompanyManager(role) },
      { id: 'compliance', label: 'Vencimientos legales', section: 'Caja y gastos', keywords: 'soat camara comercio bomberos impuestos contratos calendario legal licencias', icon: <Scale className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },

      // Análisis y reportes
      { id: 'reports', label: 'Reportes', section: 'Análisis', keywords: 'exportar csv imprimir', icon: <FileBarChart className="w-4 h-4 shrink-0" />, allowed: canViewStats(role) },
      { id: 'profit', label: 'Rentabilidad', section: 'Análisis', keywords: 'margen utilidad ganancia', icon: <PieChart className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'predict', label: 'Predicciones', section: 'Análisis', keywords: 'demanda proyeccion agotamiento', icon: <TrendingUp className="w-4 h-4 shrink-0" />, allowed: canManageInventory(role) || canManagePurchases(role) },
      { id: 'stats', label: 'Estadísticas', section: 'Análisis', keywords: 'graficas desempeno', icon: <BarChart3 className="w-4 h-4 shrink-0" />, allowed: canViewStats(role) },
      { id: 'map', label: 'Mapa y rutas', section: 'Análisis', keywords: 'gps ubicacion geocerca', icon: <MapPin className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canManageTransport(role) },
      { id: 'history', label: 'Historial de auditoría', section: 'Análisis', keywords: 'bitacora trazabilidad cambios', icon: <History className="w-4 h-4 shrink-0" />, allowed: canAccessCashAndAudit(role) },

      // Contabilidad e impuestos
      { id: 'cpa', label: 'Despacho contable', section: 'Contabilidad', keywords: 'contador publico cpc hoja trabajo 8 columnas razones niif auditoria firma cedula iva conciliacion', icon: <Calculator className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'accounting', label: 'Catálogo PUC NIIF', section: 'Contabilidad', keywords: 'plan cuentas asientos diario mayor balance comprobacion puc niif', icon: <BookOpen className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'journal_entry', label: 'Registrar Asiento Diario', section: 'Contabilidad', keywords: 'asiento diario partida doble comprobante registrar nuevo debito credito', icon: <Plus className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'accstate', label: 'Centro de Estados Financieros (Balances)', section: 'Contabilidad', keywords: 'estado resultados balance general pyg vertical', icon: <FileBarChart className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'costcenters', label: 'Centros de costo', section: 'Contabilidad', keywords: 'estado resultados sucursal sede unidad negocio pyg analitico', icon: <Layers className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },
      { id: 'accsetup', label: 'Config. contable', section: 'Contabilidad', keywords: 'conciliacion cuentas automaticas', icon: <SettingsIcon className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'accclose', label: 'Cierre de libros', section: 'Contabilidad', keywords: 'bloqueo mensual periodo', icon: <Lock className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'taxes', label: 'Impuestos', section: 'Contabilidad', keywords: 'iva fiscal tributario', icon: <Percent className="w-4 h-4 shrink-0" />, allowed: canViewAccounting(role) },
      { id: 'erpbridge', label: 'Migración Siigo / Loggro', section: 'Contabilidad', keywords: 'siigo loggro migrar importar exportar puc terceros comprobantes contable pro', icon: <ArrowLeftRight className="w-4 h-4 shrink-0" />, allowed: isCompanyManager(role) || canViewAccounting(role) },

      // Administración y soporte técnico
      { id: 'support', label: canManageTechSupport(role) ? 'Bandeja soporte técnico' : 'Soporte y autorización', section: 'Administración', keywords: 'soporte tecnico autorizar sesion ticket ayuda desarrollador aut', icon: <LifeBuoy className="w-4 h-4 shrink-0" />, allowed: true },
      { id: 'api_ecosystem', label: 'API y Webhooks', section: 'Administración', keywords: 'api token keys desarrollador woocommerce shopify webhooks integracion', icon: <Code className="w-4 h-4 shrink-0" />, allowed: canManageSettings(role) || isCompanyManager(role) },
      // REGLA 1: sqlcenter SOLO para Administrador Central ('super_admin' o 'admin')
      { id: 'sqlcenter', label: 'Centro de Scripts SQL y Supabase', section: 'Administración', keywords: 'sql supabase migraciones base datos tablas ejecutar diagnostico', icon: <Database className="w-4 h-4 shrink-0" />, allowed: isSuperAdmin },
      { id: 'team', label: 'Equipo y dispositivos', section: 'Administración', keywords: 'autorizar celulares seguridad equipos', icon: <MonitorSmartphone className="w-4 h-4 shrink-0" />, allowed: canManageTeam(role) },
      { id: 'users', label: 'Usuarios de plataforma', section: 'Administración', keywords: 'cuentas accesos', icon: <UserCog className="w-4 h-4 shrink-0" />, allowed: canManageUsers(role) },
      { id: 'companies', label: 'Empresas clientes', section: 'Administración', keywords: 'saas inquilinos', icon: <Building2 className="w-4 h-4 shrink-0" />, allowed: isSuperAdmin },
      { id: 'adminplans', label: 'Activar planes', section: 'Administración', keywords: 'licencias pagos', icon: <Gift className="w-4 h-4 shrink-0" />, allowed: isSuperAdmin },
      { id: 'subscription', label: 'Suscripción', section: 'Administración', keywords: 'plan membresia paypal', icon: <CreditCard className="w-4 h-4 shrink-0" />, allowed: isCompanyOwner || isSuperAdmin },
      { id: 'settings', label: 'Configuración', section: 'Administración', keywords: 'empresa moneda tasas iva rif nit', icon: <SettingsIcon className="w-4 h-4 shrink-0" />, allowed: canManageSettings(role) },
      { id: 'manual', label: 'Manual de usuario', section: 'Administración', keywords: 'ayuda guia documentacion', icon: <HelpCircle className="w-4 h-4 shrink-0" />, allowed: true },
    ]
  }, [role, isSuperAdmin, isCompanyOwner, isMasterAccount, isDemo])

  const allowedItems = useMemo(() => navItems.filter(n => n.allowed), [navItems])

  const paletteItems: PaletteItem[] = useMemo(
    () =>
      allowedItems.map(n => ({
        id: n.id,
        label: n.label,
        section: n.section,
        keywords: n.keywords,
        icon: n.icon,
      })),
    [allowedItems]
  )

  const currentNavItem = useMemo(
    () => navItems.find(n => n.id === current) || navItems[0],
    [navItems, current]
  )

  // Asegura que la sección del módulo actual siempre esté desplegada al navegar
  useEffect(() => {
    if (currentNavItem?.section) {
      setCollapsedSections(prev =>
        prev[currentNavItem.section] ? { ...prev, [currentNavItem.section]: false } : prev
      )
    }
  }, [currentNavItem?.section])

  const visibleItems = useMemo(() => {
    const q = navSearch.trim().toLowerCase()
    return allowedItems.filter(
      n =>
        !q ||
        n.label.toLowerCase().includes(q) ||
        n.section.toLowerCase().includes(q) ||
        (n.keywords && n.keywords.toLowerCase().includes(q))
    )
  }, [allowedItems, navSearch])

  const groupedItems = useMemo(() => {
    const groups: { section: string; items: NavItem[] }[] = []
    for (const item of visibleItems) {
      const last = groups[groups.length - 1]
      if (last && last.section === item.section) last.items.push(item)
      else groups.push({ section: item.section, items: [item] })
    }
    return groups
  }, [visibleItems])

  const handleNav = (id: string) => {
    onNavigate(id)
    setMobileOpen(false)
  }

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const roleLabel = getRoleLabel(user?.role)
  const trialDays = getTrialDaysLeft(user)
  const trialOn = isTrialActive(user)
  const subOn = isSubscriptionActive(user)

  async function handleResetDemoData() {
    await resetDemo()
    refreshCurrency()
    await refreshWarehouses()
    setDemoResetDone(true)
    window.setTimeout(() => setDemoResetDone(false), 2400)
  }

  function renderDemoBanner() {
    if (!isDemo) return null

    return (
      <div className="bg-slate-900 text-slate-100 border-b border-slate-800 px-4 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-slate-300 min-w-0">
          <span className="font-semibold text-white">Entorno de demostración</span>
          {' · '}
          <span>Distribuidora Los Andes C.A.</span>
          <span className="hidden xl:inline text-slate-400"> · Explora cada rol empresarial</span>
          {demoResetDone && (
            <span className="ml-2 text-emerald-400 font-medium">· Datos restaurados</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700 overflow-x-auto max-w-full">
            {DEMO_ROLES.map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => void switchDemoRole(r.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  demoRole === r.id
                    ? 'bg-white text-slate-900'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void handleResetDemoData()}
            className="px-2.5 py-1 rounded-lg border border-slate-700 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 whitespace-nowrap shrink-0 transition-colors"
          >
            Restaurar datos
          </button>

          {onExitDemoToLogin && (
            <button
              type="button"
              onClick={onExitDemoToLogin}
              className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white whitespace-nowrap shrink-0 transition-colors"
            >
              Iniciar sesión
            </button>
          )}

          {onExitDemoToRegister && (
            <button
              type="button"
              onClick={onExitDemoToRegister}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
            >
              Crear cuenta gratis
            </button>
          )}
        </div>
      </div>
    )
  }

  function handleMasterRoleChange(nextRole: Role) {
    if (!isMasterAccount) return
    switchMasterRole(nextRole)
    if (nextRole === 'tecnico') {
      onNavigate('support')
    } else if (nextRole === 'contador' && (current === 'dashboard' || current === 'support' || current === 'users' || current === 'companies' || current === 'adminplans')) {
      onNavigate('cpa')
    } else if (nextRole === 'transportador' && (current === 'dashboard' || current === 'cpa' || current === 'users' || current === 'companies' || current === 'adminplans')) {
      onNavigate('dispatch')
    }
  }

  function handleMasterCompanyChange(companyId: string) {
    if (!isMasterAccount) return
    if (!companyId) {
      switchMasterRole(masterRoleOverride, null)
    } else {
      const found = masterCompanies.find(c => c.company_id === companyId)
      if (found) {
        switchMasterRole(masterRoleOverride, {
          id: found.company_id,
          name: found.company_name,
        })
      }
    }
    refreshCurrency()
    void refreshWarehouses()
  }

  function renderMasterDevBanner() {
    if (isDemo || !isMasterAccount || !user) return null

    const activeEffectiveRole: Role = user.role
    const hasOverride = masterRoleOverride !== null || masterCompanyOverride !== null

    return (
      <div className="bg-slate-900 text-slate-100 border-b border-slate-800 px-4 py-2 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
        <div className="flex items-center gap-2 text-xs min-w-0 flex-wrap">
          <KeyRound className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="font-semibold text-white whitespace-nowrap">Paso Maestro</span>
          <span className="text-slate-500" aria-hidden="true">·</span>
          <span className="font-mono text-[11px] text-slate-300 truncate">{MASTER_DEV_EMAIL}</span>
          {hasOverride && (
            <>
              <span className="text-slate-500" aria-hidden="true">·</span>
              <span className="text-amber-300 font-medium whitespace-nowrap">
                Simulando: {getRoleLabel(activeEffectiveRole)}
                {masterCompanyOverride ? ` (${masterCompanyOverride.name})` : ''}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center rounded-lg bg-slate-800 p-0.5 border border-slate-700 overflow-x-auto max-w-full">
            {MASTER_SWITCHABLE_ROLES.map(r => (
              <button
                key={r.id}
                type="button"
                title={r.fullLabel}
                onClick={() => handleMasterRoleChange(r.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activeEffectiveRole === r.id
                    ? 'bg-white text-slate-900'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                {r.shortLabel}
              </button>
            ))}
          </div>

          {masterCompanies.length > 0 && (
            <select
              aria-label="Seleccionar empresa para prueba maestra"
              value={masterCompanyOverride?.id || ''}
              onChange={e => handleMasterCompanyChange(e.target.value)}
              className="px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-slate-500 max-w-[190px] truncate"
            >
              <option value="">Empresa base ({realRole ? getRoleLabel(realRole) : 'Propia'})</option>
              {masterCompanies.map(c => (
                <option key={c.company_id} value={c.company_id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          )}

          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => handleNav('sqlcenter')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                current === 'sqlcenter'
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                  : 'border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200'
              }`}
              title="Abrir Centro de Scripts SQL y Diagnóstico Supabase"
            >
              <Database className="w-3 h-3" />
              Scripts SQL
            </button>
          )}

          {hasOverride && (
            <button
              type="button"
              onClick={() => {
                switchMasterRole(null, null)
                refreshCurrency()
                void refreshWarehouses()
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              Restablecer Admin
            </button>
          )}
        </div>
      </div>
    )
  }

  function renderTrialBanner() {
    if (isDemo || isMasterAccount) return null
    if (!user || user.role !== 'dueno') return null
    if (subOn) return null

    if (trialOn) {
      return (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <Clock className="w-4 h-4 shrink-0" />
            <span>
              Periodo de prueba: <strong className="tabular-nums">{trialDays} días</strong> restantes
            </span>
          </div>
          <button
            onClick={() => handleNav('subscription')}
            className="text-xs font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0"
          >
            Activar suscripción
          </button>
        </div>
      )
    }

    return (
      <div className="bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-red-800">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Tu periodo de prueba ha terminado. Activa tu suscripción para continuar.</span>
        </div>
        <button
          onClick={() => handleNav('subscription')}
          className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg whitespace-nowrap shrink-0"
        >
          Suscribirse
        </button>
      </div>
    )
  }

  function renderSupportPassBanner() {
    if (!activeSupportPass) return null
    return (
      <div className="bg-red-700 text-white px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-md border-b border-red-800">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-300 animate-pulse shrink-0" />
          <span>
            <strong>Pase de Soporte Técnico Activo:</strong> Autorizado para{' '}
            <strong>{activeSupportPass.scope_level.replace(/_/g, ' ')}</strong> (Código:{' '}
            <span className="font-mono font-bold tracking-widest bg-red-800 px-1.5 py-0.5 rounded">
              {activeSupportPass.access_code}
            </span>
            ).
          </span>
        </div>
        <button
          onClick={handleRevokePass}
          className="bg-white hover:bg-red-50 text-red-800 px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer shadow-xs"
        >
          Revocar Acceso Inmediatamente
        </button>
      </div>
    )
  }

  function renderDesktopContextBar() {
    return (
      <div className="hidden md:flex items-center justify-between gap-4 px-6 py-2.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 text-xs min-w-0">
          {canGoBack && onGoBack && (
            <button
              type="button"
              onClick={onGoBack}
              title={
                previousPageLabel
                  ? `Volver a ${previousPageLabel}`
                  : 'Volver a la pantalla anterior'
              }
              className="inline-flex items-center gap-1.5 px-2.5 py-1 mr-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 transition-colors shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-slate-500" />
              <span>Atrás</span>
            </button>
          )}
          <span className="text-slate-400 font-medium truncate">{currentNavItem?.section || 'Módulo'}</span>
          <span className="text-slate-300" aria-hidden="true">/</span>
          <span className="font-semibold text-slate-800 truncate">{currentNavItem?.label || 'Panel'}</span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {activeWarehouses.length > 0 && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-700">
              <WarehouseIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="text-slate-400 hidden lg:inline">Bodega:</span>
              {activeWarehouses.length > 1 ? (
                <select
                  aria-label="Seleccionar bodega operativa activa"
                  value={activeWarehouseId || ''}
                  onChange={e => setActiveWarehouseId(e.target.value)}
                  className="bg-transparent font-medium text-slate-800 focus:outline-none cursor-pointer max-w-[200px] truncate"
                >
                  {activeWarehouses.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.code ? `${w.code} · ` : ''}{w.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-medium text-slate-800 truncate max-w-[180px]">
                  {activeWarehouse?.name}
                  {activeBranch ? ` (${activeBranch.name})` : ''}
                </span>
              )}
            </div>
          )}

          <div className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-xs text-slate-600 font-mono tabular-nums">
            {cur.currency}
          </div>

          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs text-slate-600 transition-colors"
            title="Ir rápido a cualquier módulo o bodega (Ctrl+K)"
          >
            <Search className="w-3.5 h-3.5 text-slate-400" />
            <span>Ir rápido</span>
            <kbd className="font-mono text-[10px] text-slate-400 border border-slate-200 rounded px-1 py-0.2">
              Ctrl K
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => handleNav('copilot')}
            title="Alertas del Copiloto"
            className="relative p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
          >
            <Bell className="w-4 h-4" />
            {alertCount > 0 && (
              <span className="ml-1 text-[11px] font-bold tabular-nums text-red-600">
                {alertCount}
              </span>
            )}
          </button>
        </div>
      </div>
    )
  }

  function renderNavList() {
    if (groupedItems.length === 0) {
      return <p className="px-3 py-6 text-xs text-slate-400 text-center">No se encontró ese módulo.</p>
    }

    const searching = navSearch.trim().length > 0

    return groupedItems.map((group, gi) => {
      const isCollapsed = !searching && Boolean(collapsedSections[group.section])
      return (
        <div key={group.section} className={gi > 0 ? 'pt-2.5 mt-2 border-t border-slate-100' : ''}>
          <button
            type="button"
            onClick={() => toggleSection(group.section)}
            className="w-full px-3 pb-1.5 flex items-center justify-between text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
          >
            <span>{group.section}</span>
            {!searching && (
              isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
          {!isCollapsed && (
            <div className="space-y-0.5">
              {group.items.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    current === item.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                  {item.id === 'copilot' && alertCount > 0 && (
                    <span
                      className={`ml-auto text-xs font-semibold tabular-nums ${
                        current === item.id ? 'text-amber-300' : 'text-red-600'
                      }`}
                    >
                      {alertCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )
    })
  }

  const inputCls =
    'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm text-slate-800 focus:outline-none focus:border-slate-600'

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="hidden md:flex flex-col w-64 border-r border-slate-200 bg-white shrink-0">
        <div className="px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <Package className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-slate-900 text-sm truncate">InventarioPro</p>
              <p className="text-[11px] text-slate-400 truncate">Control empresarial y financiero</p>
            </div>
          </div>

          <div className="mt-3 relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={navSearch}
              onChange={e => setNavSearch(e.target.value)}
              placeholder="Filtrar menú..."
              aria-label="Filtrar menú"
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white transition-colors"
            />
            {navSearch && (
              <button
                type="button"
                onClick={() => setNavSearch('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {renderNavList()}
        </nav>

        <div className="px-3 py-3 border-t border-slate-100">
          <button
            type="button"
            onClick={openMyProfileModal}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 mb-1.5 rounded-lg hover:bg-slate-50 text-left transition-colors"
            title="Editar mi foto y datos personales"
          >
            <UserAvatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-800 truncate">{user?.full_name || user?.email}</p>
              <p className="text-[11px] text-slate-500 truncate">{roleLabel} · Mi perfil</p>
            </div>
            <Camera className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>

          {canInstall && (
            <button
              onClick={install}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-colors mb-1"
            >
              <Download className="w-4 h-4 shrink-0" /> Instalar app
            </button>
          )}

          <button
            onClick={handleLogoutAction}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" /> {isDemo ? 'Salir de la demo' : 'Cerrar sesión'}
          </button>

          <div className="mt-3 pt-2.5 border-t border-slate-100">
            <p className="text-[10px] text-slate-400 text-center leading-relaxed">
              <span className="font-semibold text-slate-500">Copyright</span> · Desarrollado por
              <br />
              <span className="font-semibold text-slate-600">Richard J. Lobo S.</span>
            </p>
          </div>
        </div>
      </aside>

      {/* Barra superior móvil */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 bg-white border-b border-slate-200 px-3 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && onGoBack && (
            <button
              type="button"
              onClick={onGoBack}
              aria-label={
                previousPageLabel
                  ? `Volver a ${previousPageLabel}`
                  : 'Volver a la pantalla anterior'
              }
              title={
                previousPageLabel
                  ? `Volver a ${previousPageLabel}`
                  : 'Volver a la pantalla anterior'
              }
              className="p-1.5 -ml-1 rounded-lg border border-slate-200 bg-slate-50 active:bg-slate-100 text-slate-700 shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">InventarioPro</p>
            <p className="text-[10px] text-slate-500 truncate">{currentNavItem?.label}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Buscar módulo"
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-600"
          >
            <Search className="w-5 h-5" />
          </button>

          <button
            onClick={() => handleNav('copilot')}
            title="Copiloto"
            className="relative p-2 rounded-lg hover:bg-slate-100"
          >
            <Bell className="w-5 h-5 text-slate-600" />
            {alertCount > 0 && (
              <span className="absolute top-1 right-1 text-[10px] font-bold tabular-nums text-red-600">
                {alertCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Menú"
            className="p-2 rounded-lg hover:bg-slate-100"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Menú móvil */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-20 bg-black/40"
          onClick={() => setMobileOpen(false)}
        >
          <div
            className="absolute top-0 left-0 bottom-0 w-72 bg-white flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 pt-4 pb-3 border-b border-slate-100 mt-14">
              <button
                type="button"
                onClick={openMyProfileModal}
                className="w-full flex items-center gap-2.5 pb-2.5 mb-2.5 border-b border-slate-100 text-left"
              >
                <UserAvatar src={user?.avatar_url} name={user?.full_name} email={user?.email} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-800 truncate">{user?.full_name || user?.email}</p>
                  <p className="text-[11px] text-slate-500">{roleLabel} · Mi perfil</p>
                </div>
                <Camera className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              </button>

              {!isDemo && isMasterAccount && user && (
                <div className="mb-2.5 pb-2.5 border-b border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                      <KeyRound className="w-3 h-3 text-amber-600" />
                      Paso Maestro
                    </span>
                    {(masterRoleOverride !== null || masterCompanyOverride !== null) && (
                      <button
                        type="button"
                        onClick={() => {
                          switchMasterRole(null, null)
                          setMobileOpen(false)
                        }}
                        className="text-[11px] font-medium text-amber-700 underline whitespace-nowrap"
                      >
                        Restablecer
                      </button>
                    )}
                  </div>
                  <select
                    aria-label="Cambiar rol activo (Paso Maestro)"
                    value={user.role}
                    onChange={e => {
                      handleMasterRoleChange(e.target.value as Role)
                      setMobileOpen(false)
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-medium text-slate-800 focus:outline-none focus:border-slate-600"
                  >
                    {MASTER_SWITCHABLE_ROLES.map(r => (
                      <option key={r.id} value={r.id}>
                        {r.fullLabel}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={navSearch}
                  onChange={e => setNavSearch(e.target.value)}
                  placeholder="Filtrar menú..."
                  aria-label="Filtrar menú"
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-slate-400 focus:bg-white"
                />
                {navSearch && (
                  <button
                    type="button"
                    onClick={() => setNavSearch('')}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            <nav className="flex-1 min-h-0 px-3 py-3 overflow-y-auto">
              {renderNavList()}
            </nav>

            <div className="px-3 py-3 border-t border-slate-100">
              {canInstall && (
                <button
                  onClick={install}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 mb-1"
                >
                  <Download className="w-4 h-4 shrink-0" /> Instalar app
                </button>
              )}

              <button
                onClick={handleLogoutAction}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600"
              >
                <LogOut className="w-4 h-4 shrink-0" /> {isDemo ? 'Salir de la demo' : 'Cerrar sesión'}
              </button>

              <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 text-center leading-relaxed">
                  <span className="font-semibold text-slate-500">Copyright</span> · Desarrollado por
                  <br />
                  <span className="font-semibold text-slate-600">Richard J. Lobo S.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 min-w-0 overflow-y-auto pt-14 md:pt-0">
        {renderSupportPassBanner()}
        {renderDemoBanner()}
        {renderMasterDevBanner()}
        {renderTrialBanner()}
        {renderDesktopContextBar()}

        {inviteNotice && (
          <div className="bg-emerald-50 border-b border-emerald-200 px-4 py-2.5 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-emerald-800">{inviteNotice}</span>
            <button
              type="button"
              onClick={clearInviteNotice}
              className="p-1 rounded hover:bg-emerald-100 text-emerald-700"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="p-4 md:p-6 max-w-7xl mx-auto">
          {children}
        </div>
      </main>

      {/* Paleta rápida de módulos y bodegas (Ctrl+K / Cmd+K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        warehouses={activeWarehouses}
        activeWarehouseId={activeWarehouseId}
        onSelectPage={handleNav}
        onSelectWarehouse={setActiveWarehouseId}
      />

      {/* Modal propio: Mi perfil y foto */}
      {profileModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto"
          onClick={() => !savingProfile && setProfileModalOpen(false)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 w-full max-w-lg my-8 overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Mi perfil e identificación</h2>
                <p className="text-xs text-slate-500">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                className="p-1 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveMyProfile} className="p-5 space-y-4">
              {profileFeedback && (
                <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {profileFeedback}
                </p>
              )}

              <AvatarCapture
                value={myForm.avatar_url}
                name={myForm.full_name}
                email={user?.email}
                onChange={avatar_url => setMyForm({ ...myForm, avatar_url })}
                disabled={savingProfile}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo</label>
                  <input
                    required
                    value={myForm.full_name}
                    onChange={e => setMyForm({ ...myForm, full_name: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cédula / ID</label>
                  <input
                    value={myForm.national_id}
                    onChange={e => setMyForm({ ...myForm, national_id: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono / WhatsApp</label>
                  <input
                    value={myForm.phone}
                    onChange={e => setMyForm({ ...myForm, phone: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Contacto de emergencia</label>
                  <input
                    value={myForm.emergency_contact}
                    onChange={e => setMyForm({ ...myForm, emergency_contact: e.target.value })}
                    className={inputCls}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
                  <input
                    value={myForm.address}
                    onChange={e => setMyForm({ ...myForm, address: e.target.value })}
                    className={inputCls}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  disabled={savingProfile}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingProfile ? 'Guardando...' : 'Guardar mi perfil'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {exitHintVisible && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-lg border border-slate-700 whitespace-nowrap pointer-events-none"
        >
          Estás en el inicio · Pulsa atrás de nuevo para salir
        </div>
      )}
    </div>
  )
}
