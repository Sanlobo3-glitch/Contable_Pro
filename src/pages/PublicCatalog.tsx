import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { formatMoney, parseFxRates } from '../lib/currency'
import { calcTax, round2, type TaxMode } from '../lib/tax'
import { copyToClipboard } from '../lib/copilotShare'
import { esc, printHtml } from '../lib/documents'
import { useBackOverlay } from '../lib/navigation'
import { ProductPhotoLightbox, ProductThumb } from '../components/ProductImageCapture'
import {
  DELIVERY_MODE_LABELS,
  ORDER_STATUS_META,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_META,
  normalizeCatalogPaymentMethods,
  normalizeDeliveryModes,
  normalizeProductVariants,
  resolveBrandTheme,
  uploadCatalogAssetOrInline,
} from '../lib/catalogCommerce'
import {
  cartKeyOf,
  clearPersistedCart,
  getPublicCartStorageKey,
  parseCartKey,
  readPersistedCart,
  reconcilePersistedCartWithCatalog,
  writePersistedCart,
  type CartLineSnapshot,
} from '../lib/catalogCartStorage'
import {
  buildCompanyStoreUrl,
  isUuidIdentifier,
  normalizeWhatsAppSettings,
} from '../lib/whatsappStudio'
import type {
  BrandThemeId,
  CatalogDeliveryMode,
  CatalogPaymentMethodConfig,
  CatalogPaymentStatus,
  CatalogOrderStatus,
  CompanyWhatsAppSettings,
  CustomerLegalType,
  ProductVariant,
} from '../types'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  CreditCard,
  Eye,
  FileCheck2,
  ImagePlus,
  Loader2,
  MessageCircle,
  Minus,
  PackageSearch,
  Plus,
  Printer,
  Search,
  Share2,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  User,
  X,
} from 'lucide-react'

interface PublicCompanyInfo {
  company_id: string
  catalog_slug?: string | null
  name: string
  rif?: string | null
  email?: string | null
  phone: string | null
  address: string | null
  currency: string
  tax_rate: number
  tax_mode: string
  show_wholesale: boolean
  show_stock: boolean
  welcome: string | null
  logo_url?: string | null
  brand_theme?: BrandThemeId | null
  fx_rates?: Record<string, number> | null
  payment_methods?: CatalogPaymentMethodConfig[] | null
  delivery_modes?: CatalogDeliveryMode[] | null
  whatsapp_settings?: CompanyWhatsAppSettings | null
}

interface PublicCategory {
  id: string
  name: string
}

interface PublicProduct {
  id: string
  name: string
  sku: string
  description?: string | null
  featured?: boolean
  category_id: string | null
  category_name: string | null
  price: number
  price_wholesale: number | null
  wholesale_min_qty: number | null
  unit: string
  stock: number
  exact_stock?: number | null
  in_stock: boolean
  image_url: string | null
  variant_group_label?: string | null
  variants?: ProductVariant[] | null
}

interface StockAlertNotice {
  id: number
  productId: string
  variantId: string | null
  title: string
  message: string
  availableUnits: number | null
  requestedUnits: number
  canQuickAddAvailable: boolean
}

interface LiveProductCheckResult {
  ok: boolean
  found: boolean
  available: boolean
  exactStockKnown: boolean
  stock: number
  inStock: boolean
  product: PublicProduct | null
  errorMessage?: string
}

interface OrderResult {
  order_id?: string
  order_number: string
  tracking_pin?: string
  payment_status?: CatalogPaymentStatus
  order_status?: CatalogOrderStatus
  total: number
  subtotal: number
  tax_amount: number
  currency: string
  company_phone: string | null
  company_name: string
}

interface TrackedOrderInfo {
  order_number: string
  customer_name: string
  customer_type: CustomerLegalType
  total: number
  currency: string
  payment_method: string
  payment_reference: string | null
  payment_status: CatalogPaymentStatus
  order_status: CatalogOrderStatus
  delivery_mode: CatalogDeliveryMode
  verified_at: string | null
  admin_notes: string | null
  created_at: string
  items: {
    product_name: string
    variant_label?: string | null
    quantity: number
    unit_price: number
    subtotal: number
  }[]
}

const BUYER_CACHE_KEY = 'ip_public_buyer_profile_v1'

interface CachedBuyerProfile {
  customerType: CustomerLegalType
  customerName: string
  documentId: string
  contactPerson: string
  requiresInvoice: boolean
  phone: string
  email: string
  address: string
}

function readBuyerCache(): Partial<CachedBuyerProfile> {
  try {
    const raw = localStorage.getItem(BUYER_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<CachedBuyerProfile>
  } catch {
    return {}
  }
}

function saveBuyerCache(data: CachedBuyerProfile): void {
  try {
    localStorage.setItem(BUYER_CACHE_KEY, JSON.stringify(data))
  } catch {
    /* ignore */
  }
}

function cleanPhoneDigits(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/[^\d]/g, '')
  return digits.length >= 8 ? digits : null
}

export default function PublicCatalog({
  companyId,
  onExitPreview,
  onOpenCatalogOrders,
}: {
  companyId: string
  onExitPreview?: () => void
  onOpenCatalogOrders?: () => void
}) {
  const initialPersistedCart = useMemo(() => readPersistedCart(companyId), [companyId])

  const [loading, setLoading] = useState(true)
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null)
  const [company, setCompany] = useState<PublicCompanyInfo | null>(null)
  const [categories, setCategories] = useState<PublicCategory[]>([])
  const [products, setProducts] = useState<PublicProduct[]>([])

  const [activeView, setActiveView] = useState<'store' | 'track'>('store')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selectedVariantByProd, setSelectedVariantByProd] = useState<Record<string, string>>(
    () => initialPersistedCart.selectedVariants
  )
  const [cart, setCart] = useState<Record<string, number>>(() => initialPersistedCart.items)
  const [cartStep, setCartStep] = useState<'cart' | 'checkout'>(
    () => (initialPersistedCart.checkoutDraft.step === 'checkout' ? 'checkout' : 'cart')
  )
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [confirmClearCart, setConfirmClearCart] = useState(false)
  const [cartReconcileNotices, setCartReconcileNotices] = useState<string[]>([])
  const [pendingQtyByProd, setPendingQtyByProd] = useState<Record<string, number>>({})
  const [pendingDraftByProd, setPendingDraftByProd] = useState<Record<string, string>>({})
  const [cartQtyDraftByKey, setCartQtyDraftByKey] = useState<Record<string, string>>({})
  const [verifyingByProd, setVerifyingByProd] = useState<Record<string, boolean>>({})
  const [verifyingCheckoutStock, setVerifyingCheckoutStock] = useState(false)
  const [stockAlert, setStockAlert] = useState<StockAlertNotice | null>(null)
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null)
  const [previewProduct, setPreviewProduct] = useState<PublicProduct | null>(null)
  const [displayFxCode, setDisplayFxCode] = useState<string>('BASE')

  // Datos del comprador (Persona Natural o Jurídica)
  const cachedBuyer = useMemo(() => readBuyerCache(), [])
  const [customerType, setCustomerType] = useState<CustomerLegalType>(
    cachedBuyer.customerType === 'juridica' ? 'juridica' : 'natural'
  )
  const [customerName, setCustomerName] = useState(cachedBuyer.customerName || '')
  const [documentId, setDocumentId] = useState(cachedBuyer.documentId || '')
  const [contactPerson, setContactPerson] = useState(cachedBuyer.contactPerson || '')
  const [requiresInvoice, setRequiresInvoice] = useState(Boolean(cachedBuyer.requiresInvoice))
  const [phone, setPhone] = useState(cachedBuyer.phone || '')
  const [email, setEmail] = useState(cachedBuyer.email || '')
  const [deliveryMode, setDeliveryMode] = useState<CatalogDeliveryMode>(
    () => initialPersistedCart.checkoutDraft.deliveryMode || 'delivery'
  )
  const [address, setAddress] = useState(cachedBuyer.address || '')
  const [notes, setNotes] = useState(() => initialPersistedCart.checkoutDraft.notes || '')

  // Pago y capture
  const [selectedPaymentId, setSelectedPaymentId] = useState<string>(
    () => initialPersistedCart.checkoutDraft.selectedPaymentId || 'pago_movil'
  )
  const [paymentReference, setPaymentReference] = useState(
    () => initialPersistedCart.checkoutDraft.paymentReference || ''
  )
  const [paymentSenderBank, setPaymentSenderBank] = useState(
    () => initialPersistedCart.checkoutDraft.paymentSenderBank || ''
  )
  const [paymentAmountInput, setPaymentAmountInput] = useState(
    () => initialPersistedCart.checkoutDraft.paymentAmountInput || ''
  )
  const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(
    () => initialPersistedCart.checkoutDraft.paymentProofUrl || null
  )
  const [uploadingProof, setUploadingProof] = useState(false)
  const [copiedPayData, setCopiedPayData] = useState(false)
  const [copiedStoreUrl, setCopiedStoreUrl] = useState(false)
  const proofInputRef = useRef<HTMLInputElement | null>(null)

  const snapshotsRef = useRef<Record<string, CartLineSnapshot>>(initialPersistedCart.snapshots)
  const cartRef = useRef(cart)
  cartRef.current = cart
  const productsRef = useRef(products)
  productsRef.current = products
  const companyRef = useRef(company)
  companyRef.current = company
  const selectedVariantsRef = useRef(selectedVariantByProd)
  selectedVariantsRef.current = selectedVariantByProd
  const hydratedCompanyRef = useRef(companyId)
  const skipNextStorageWriteRef = useRef(false)
  const addedTimerRef = useRef<number | null>(null)
  const stockAlertTimerRef = useRef<number | null>(null)
  const verifyRpcSupportedRef = useRef<boolean | null>(null)
  const inFlightProdRef = useRef<Record<string, boolean>>({})

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmedOrder, setConfirmedOrder] = useState<{
    result: OrderResult
    lines: {
      name: string
      variantLabel?: string | null
      qty: number
      unitPrice: number
      subtotal: number
    }[]
    customerName: string
    customerType: CustomerLegalType
    documentId: string
    paymentLabel: string
    paymentReference: string
    hasProof: boolean
  } | null>(null)

  // Consulta / Rastreo de pedido en vivo
  const [trackCode, setTrackCode] = useState('')
  const [trackPin, setTrackPin] = useState('')
  const [trackingLoading, setTrackingLoading] = useState(false)
  const [trackError, setTrackError] = useState<string | null>(null)
  const [trackedOrder, setTrackedOrder] = useState<TrackedOrderInfo | null>(null)

  // Integración con botón «Atrás» y tecla Escape para el carrito / checkout
  useBackOverlay(drawerOpen && !submitting, () => setDrawerOpen(false))
  useBackOverlay(drawerOpen && cartStep === 'checkout' && !submitting, () => setCartStep('cart'))

  useEffect(() => {
    return () => {
      if (addedTimerRef.current !== null) {
        window.clearTimeout(addedTimerRef.current)
      }
      if (stockAlertTimerRef.current !== null) {
        window.clearTimeout(stockAlertTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        setDrawerOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, submitting])

  // Si cambia la empresa previsualizada, rehidratar el carrito aislado de esa empresa
  useEffect(() => {
    if (hydratedCompanyRef.current === companyId) return
    const fresh = readPersistedCart(companyId)
    hydratedCompanyRef.current = companyId
    snapshotsRef.current = fresh.snapshots
    skipNextStorageWriteRef.current = true
    setCart(fresh.items)
    setSelectedVariantByProd(fresh.selectedVariants)
    setCartStep(fresh.checkoutDraft.step === 'checkout' ? 'checkout' : 'cart')
    setDeliveryMode(fresh.checkoutDraft.deliveryMode || 'delivery')
    setSelectedPaymentId(fresh.checkoutDraft.selectedPaymentId || 'pago_movil')
    setPaymentReference(fresh.checkoutDraft.paymentReference || '')
    setPaymentSenderBank(fresh.checkoutDraft.paymentSenderBank || '')
    setPaymentAmountInput(fresh.checkoutDraft.paymentAmountInput || '')
    setNotes(fresh.checkoutDraft.notes || '')
    setPaymentProofUrl(fresh.checkoutDraft.paymentProofUrl || null)
    setCartReconcileNotices([])
    setStockAlert(null)
    setPendingDraftByProd({})
    setCartQtyDraftByKey({})
    setConfirmClearCart(false)
  }, [companyId])

  // Sincronización entre pestañas abiertas del mismo catálogo
  useEffect(() => {
    const targetStorageKey = getPublicCartStorageKey(companyId)
    const onStorage = (e: StorageEvent) => {
      if (e.key !== targetStorageKey) return
      const external = readPersistedCart(companyId)
      snapshotsRef.current = external.snapshots
      skipNextStorageWriteRef.current = true
      setCart(external.items)
      setSelectedVariantByProd(external.selectedVariants)
      if (Object.keys(external.items).length === 0) {
        setCartStep('cart')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [companyId])

  useEffect(() => {
    let active = true
    async function fetchCatalog() {
      setLoading(true)
      setUnavailableReason(null)

      let rpcRes = await supabase.rpc('resolver_catalogo_publico', {
        p_slug_or_id: companyId,
      })

      if (
        rpcRes.error &&
        /resolver_catalogo_publico|does not exist|schema cache|PGRST202/i.test(
          `${rpcRes.error.message || ''} ${rpcRes.error.code || ''}`
        )
      ) {
        let fallbackUuid = isUuidIdentifier(companyId) ? companyId : ''
        if (!fallbackUuid && typeof window !== 'undefined') {
          const prefetched = (window as unknown as { __IP_STORE_PREFETCH__?: { company_id?: string } })
            .__IP_STORE_PREFETCH__
          if (prefetched?.company_id && isUuidIdentifier(prefetched.company_id)) {
            fallbackUuid = prefetched.company_id
          }
        }
        if (!fallbackUuid) {
          try {
            const metaResp = await fetch(
              `/api/store-preview?format=json&store=${encodeURIComponent(companyId)}`
            )
            if (metaResp.ok) {
              const metaJson = (await metaResp.json()) as {
                found?: boolean
                meta?: { company_id?: string } | null
              }
              if (metaJson?.found && metaJson.meta?.company_id && isUuidIdentifier(metaJson.meta.company_id)) {
                fallbackUuid = metaJson.meta.company_id
              }
            }
          } catch {
            /* ignore */
          }
        }
        if (fallbackUuid) {
          rpcRes = await supabase.rpc('obtener_catalogo_publico', {
            p_company_id: fallbackUuid,
          })
        } else {
          if (!active) return
          setLoading(false)
          setUnavailableReason(
            'Este enlace personalizado requiere actualizar el paquete SQL en Supabase.'
          )
          return
        }
      }

      const { data, error } = rpcRes
      if (!active) return
      setLoading(false)

      if (error) {
        setUnavailableReason(
          /obtener_catalogo_publico|resolver_catalogo_publico|does not exist|schema cache/i.test(
            error.message || ''
          )
            ? 'El catálogo digital requiere activar el paquete SQL en Supabase.'
            : 'No fue posible cargar el catálogo en este momento.'
        )
        return
      }

      const payload = data as Record<string, unknown> | null
      if (!payload?.available) {
        setUnavailableReason(
          String(payload?.reason || 'Este catálogo comercial no está disponible.')
        )
        return
      }

      const comp = payload.company as PublicCompanyInfo
      const prods = ((payload.products || []) as PublicProduct[]).map(p => ({
        ...p,
        exact_stock: comp.show_stock
          ? Math.max(0, Number(p.stock) || 0)
          : !p.in_stock
            ? 0
            : null,
        variants: normalizeProductVariants(p.variants),
      }))
      setCompany(comp)
      setCategories((payload.categories || []) as PublicCategory[])
      setProducts(prods)

      // Reconciliar carrito persistido en localStorage contra inventario y variantes vigentes
      const reconciled = reconcilePersistedCartWithCatalog({
        savedItems: cartRef.current,
        savedVariants: selectedVariantsRef.current,
        snapshots: snapshotsRef.current,
        products: prods,
        showStock: Boolean(comp.show_stock),
      })
      setCart(reconciled.nextItems)
      setSelectedVariantByProd(reconciled.nextSelectedVariants)
      if (reconciled.notices.length > 0) {
        setCartReconcileNotices(reconciled.notices)
      }
      if (Object.keys(reconciled.nextItems).length === 0) {
        setCartStep('cart')
      }

      const modes = normalizeDeliveryModes(comp.delivery_modes)
      if (modes.length > 0) {
        setDeliveryMode(prev => (modes.includes(prev) ? prev : modes[0]))
      }

      const methods = normalizeCatalogPaymentMethods(comp.payment_methods, {
        companyName: comp.name,
        rif: comp.rif || '',
        phone: comp.phone || '',
        email: comp.email || '',
      }).filter(m => m.enabled)
      if (methods.length > 0) {
        setSelectedPaymentId(prev =>
          methods.some(m => m.id === prev) ? prev : methods[0].id
        )
      }
    }
    void fetchCatalog()
    return () => {
      active = false
    }
  }, [companyId])

  const resolvedCompanyUuid =
    company?.company_id || (isUuidIdentifier(companyId) ? companyId : '')

  // Suscripción complementaria a cambios de inventario en vivo desde Supabase Realtime
  useEffect(() => {
    if (!resolvedCompanyUuid) return
    const channel = supabase
      .channel(`public-catalog-inventory-${resolvedCompanyUuid}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'products',
          filter: `company_id=eq.${resolvedCompanyUuid}`,
        },
        payload => {
          const row = payload.new as Record<string, unknown> | null
          if (!row || typeof row.id !== 'string') return
          const pid = row.id
          const liveStock = Math.max(0, Number(row.stock) || 0)
          const visible = row.catalog_visible !== false
          const liveInStock = visible && liveStock > 0
          const showStock = Boolean(companyRef.current?.show_stock)

          setProducts(prev =>
            prev.map(item => {
              if (item.id !== pid) return item
              return {
                ...item,
                stock: showStock ? liveStock : liveInStock ? 1 : 0,
                exact_stock: liveStock,
                in_stock: liveInStock,
                variants:
                  row.variants !== undefined
                    ? normalizeProductVariants(row.variants as ProductVariant[])
                    : item.variants,
              }
            })
          )
          setPreviewProduct(prev => {
            if (!prev || prev.id !== pid) return prev
            return {
              ...prev,
              stock: showStock ? liveStock : liveInStock ? 1 : 0,
              exact_stock: liveStock,
              in_stock: liveInStock,
              variants:
                row.variants !== undefined
                  ? normalizeProductVariants(row.variants as ProductVariant[])
                  : prev.variants,
            }
          })
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [resolvedCompanyUuid])

  const brand = useMemo(() => resolveBrandTheme(company?.brand_theme), [company?.brand_theme])
  const waSettings = useMemo(
    () =>
      normalizeWhatsAppSettings(company?.whatsapp_settings, {
        companyName: company?.name,
        phone: company?.phone || '',
        welcome: company?.welcome,
      }),
    [company]
  )
  const canonicalStoreUrl = useMemo(() => {
    if (!company) return typeof window !== 'undefined' ? window.location.href : ''
    return buildCompanyStoreUrl(
      window.location.origin,
      company.company_id,
      company.catalog_slug || (!isUuidIdentifier(companyId) ? companyId : null)
    )
  }, [company, companyId])

  // Sincronizar título de pestaña, ícono y color de navegador con la identidad de la empresa
  useEffect(() => {
    if (!company || typeof document === 'undefined') return
    const prevTitle = document.title
    const iconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const prevIconHref = iconEl?.getAttribute('href') || null
    const themeEl = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    const prevThemeColor = themeEl?.getAttribute('content') || null

    const headline =
      waSettings.brand_tagline || company.welcome || 'Tienda y Catálogo Oficial'
    document.title = `${company.name} — ${headline}`

    const storeKey = company.catalog_slug || company.company_id
    const companyIconHref =
      company.logo_url ||
      `/api/store-preview?asset=logo&store=${encodeURIComponent(storeKey)}`
    if (iconEl) {
      iconEl.setAttribute('href', companyIconHref)
    }
    if (themeEl) {
      themeEl.setAttribute('content', brand.hex)
    }

    return () => {
      document.title = prevTitle
      if (iconEl && prevIconHref) iconEl.setAttribute('href', prevIconHref)
      if (themeEl && prevThemeColor) themeEl.setAttribute('content', prevThemeColor)
    }
  }, [company, waSettings.brand_tagline, brand.hex])

  async function handleShareStoreUrl() {
    if (!canonicalStoreUrl || !company) return
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: company.name,
          text: waSettings.brand_tagline || company.welcome || `Catálogo oficial de ${company.name}`,
          url: canonicalStoreUrl,
        })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    const ok = await copyToClipboard(canonicalStoreUrl)
    if (ok) {
      setCopiedStoreUrl(true)
      window.setTimeout(() => setCopiedStoreUrl(false), 2400)
    }
  }
  const baseCur = company?.currency || 'USD'
  const money = (n: number) => formatMoney(n, baseCur)

  const fxMap = useMemo(() => parseFxRates(company?.fx_rates), [company?.fx_rates])
  const availableFxCodes = useMemo(
    () => Object.keys(fxMap).filter(code => code !== baseCur && Number(fxMap[code]) > 0),
    [fxMap, baseCur]
  )
  const activeFxRate = displayFxCode !== 'BASE' ? Number(fxMap[displayFxCode]) || 0 : 0

  function formatDisplayPrice(amountBase: number): { main: string; sub?: string } {
    if (activeFxRate > 0 && displayFxCode !== 'BASE') {
      // Consistente con Configuración: 1 unidad de otra moneda = rate moneda base => equivalente = base / rate
      // Nota: si la tasa es > 1 y moneda base es USD y código es VES/COP (ej. 1 USD = 42.5 VES guardado como 42.5 o 0.023),
      // respetamos convención: si rate > 1 para VES/COP frente a USD, multiplicamos si moneda base es USD; si no, dividimos.
      const isLocalPerUsd =
        baseCur === 'USD' && ['VES', 'COP', 'ARS', 'CLP', 'MXN', 'PEN', 'BRL'].includes(displayFxCode) && activeFxRate > 1.5
      const converted = isLocalPerUsd
        ? round2(amountBase * activeFxRate)
        : round2(amountBase / activeFxRate)
      return {
        main: formatMoney(converted, displayFxCode),
        sub: money(amountBase),
      }
    }
    return { main: money(amountBase) }
  }

  const activePaymentMethods = useMemo(() => {
    if (!company) return []
    return normalizeCatalogPaymentMethods(company.payment_methods, {
      companyName: company.name,
      rif: company.rif || '',
      phone: company.phone || '',
      email: company.email || '',
    }).filter(m => m.enabled)
  }, [company])

  const activeDeliveryModes = useMemo(
    () => normalizeDeliveryModes(company?.delivery_modes),
    [company?.delivery_modes]
  )

  const currentPaymentConfig = useMemo(
    () =>
      activePaymentMethods.find(m => m.id === selectedPaymentId) ||
      activePaymentMethods[0] ||
      null,
    [activePaymentMethods, selectedPaymentId]
  )

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return products.filter(p => {
      if (selectedCategory !== 'all' && p.category_id !== selectedCategory) return false
      if (!q) return true
      const varText = (p.variants || []).map(v => v.label).join(' ')
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku || '').toLowerCase().includes(q) ||
        (p.category_name || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        varText.toLowerCase().includes(q)
      )
    })
  }, [products, selectedCategory, search])

  function getActiveVariant(p: PublicProduct): ProductVariant | null {
    const vars = p.variants || []
    if (vars.length === 0) return null
    const chosenId = selectedVariantByProd[p.id]
    return (
      vars.find(v => v.id === chosenId && v.available !== false) ||
      vars.find(v => v.available !== false) ||
      vars[0]
    )
  }

  function dismissStockAlert() {
    if (stockAlertTimerRef.current !== null) {
      window.clearTimeout(stockAlertTimerRef.current)
      stockAlertTimerRef.current = null
    }
    setStockAlert(null)
  }

  function emitStockAlert(notice: Omit<StockAlertNotice, 'id'>) {
    if (stockAlertTimerRef.current !== null) {
      window.clearTimeout(stockAlertTimerRef.current)
    }
    const id = Date.now()
    setStockAlert({ ...notice, id })
    stockAlertTimerRef.current = window.setTimeout(() => {
      setStockAlert(curr => (curr && curr.id === id ? null : curr))
      stockAlertTimerRef.current = null
    }, 8000)
  }

  function getReservedBaseByOtherVariants(
    p: PublicProduct,
    excludeVariantId: string | null | undefined,
    cartState: Record<string, number> = cart
  ): number {
    const targetKey = cartKeyOf(p.id, excludeVariantId)
    let otherBaseReserved = 0
    for (const [key, qty] of Object.entries(cartState)) {
      if (key === targetKey || !(qty > 0)) continue
      const parsed = parseCartKey(key)
      if (parsed.productId !== p.id) continue
      const otherVar = parsed.variantId
        ? (p.variants || []).find(v => v.id === parsed.variantId) || null
        : null
      const otherMult =
        otherVar?.stock_multiplier && otherVar.stock_multiplier > 0
          ? otherVar.stock_multiplier
          : 1
      otherBaseReserved += qty * otherMult
    }
    return round2(otherBaseReserved)
  }

  function getMaxQtyForVariant(
    p: PublicProduct,
    variant: ProductVariant | null,
    cartState: Record<string, number> = cart
  ): number {
    if (!p.in_stock) return 0
    const hasExactStock =
      typeof p.exact_stock === 'number' && Number.isFinite(p.exact_stock)
    if (!hasExactStock && !company?.show_stock) return 9999

    const baseStock = hasExactStock
      ? Math.max(0, Number(p.exact_stock) || 0)
      : Math.max(0, Number(p.stock) || 0)
    const otherBaseReserved = getReservedBaseByOtherVariants(p, variant?.id, cartState)
    const availableBase = Math.max(0, baseStock - otherBaseReserved)

    if (!variant) {
      return Math.max(0, round2(availableBase))
    }
    const mult =
      variant.stock_multiplier && variant.stock_multiplier > 0 ? variant.stock_multiplier : 1
    return Math.max(0, Math.floor((availableBase + 1e-9) / mult))
  }

  function buildInsufficientStockNotice(
    liveProd: PublicProduct,
    liveVariant: ProductVariant | null,
    requestedQty: number,
    liveMaxUnits: number,
    liveBaseStock: number,
    otherReservedBase: number,
    canQuickAddAvailable: boolean
  ): Omit<StockAlertNotice, 'id'> {
    const itemLabel = liveVariant ? `${liveProd.name} (${liveVariant.label})` : liveProd.name
    const unitLabel = liveVariant ? liveVariant.label : liveProd.unit || 'und.'

    if (!liveProd.in_stock || liveBaseStock <= 0) {
      return {
        productId: liveProd.id,
        variantId: liveVariant?.id || null,
        title: 'Producto sin stock disponible',
        message: `«${itemLabel}» se encuentra agotado en el inventario en tiempo real (0 disponibles).`,
        availableUnits: 0,
        requestedUnits: requestedQty,
        canQuickAddAvailable: false,
      }
    }

    if (liveMaxUnits <= 0 && otherReservedBase > 0) {
      return {
        productId: liveProd.id,
        variantId: liveVariant?.id || null,
        title: 'Stock disponible ya cubierto en tu carrito',
        message: `Solicitaste ${requestedQty} de «${itemLabel}», pero el stock en tiempo real (${liveBaseStock} ${liveProd.unit || 'und.'}) ya está reservado en tu carrito.`,
        availableUnits: 0,
        requestedUnits: requestedQty,
        canQuickAddAvailable: false,
      }
    }

    if (liveMaxUnits <= 0) {
      return {
        productId: liveProd.id,
        variantId: liveVariant?.id || null,
        title: 'Stock insuficiente para esta presentación',
        message: `Solicitaste ${requestedQty} de «${itemLabel}», pero solo quedan ${liveBaseStock} ${liveProd.unit || 'und.'} en inventario en tiempo real.`,
        availableUnits: 0,
        requestedUnits: requestedQty,
        canQuickAddAvailable: false,
      }
    }

    return {
      productId: liveProd.id,
      variantId: liveVariant?.id || null,
      title: 'La cantidad solicitada supera el stock disponible',
      message:
        otherReservedBase > 0
          ? `Solicitaste ${requestedQty} de «${itemLabel}», pero según el inventario en tiempo real solo puedes llevar hasta ${liveMaxUnits} ${unitLabel} (considerando las otras presentaciones en tu carrito).`
          : `Solicitaste ${requestedQty} de «${itemLabel}», pero en tiempo real solo hay ${liveMaxUnits} ${liveMaxUnits === 1 ? 'disponible' : 'disponibles'} en inventario.`,
      availableUnits: liveMaxUnits,
      requestedUnits: requestedQty,
      canQuickAddAvailable,
    }
  }

  // Consulta en tiempo real a Supabase antes de añadir o incrementar unidades en el carrito
  async function verifyLiveProductStock(
    productId: string,
    requestedBaseQty = 1
  ): Promise<LiveProductCheckResult> {
    const existingProd = productsRef.current.find(x => x.id === productId) || null
    const showStock = Boolean(companyRef.current?.show_stock)
    const targetUuid =
      companyRef.current?.company_id || (isUuidIdentifier(companyId) ? companyId : '')

    // 1. Intentar RPC ligera dedicada de verificación en tiempo real (anon + authenticated)
    if (verifyRpcSupportedRef.current !== false && targetUuid) {
      const { data, error } = await supabase.rpc('verificar_stock_catalogo_publico', {
        p_company_id: targetUuid,
        p_product_id: productId,
        p_requested_base_qty: round2(Math.max(0.01, requestedBaseQty)),
      })

      if (!error && data && typeof data === 'object') {
        verifyRpcSupportedRef.current = true
        const payload = data as Record<string, unknown>
        const found = payload.found !== false && Boolean(payload.available)
        if (!found) {
          const markedUnavailable = existingProd
            ? { ...existingProd, stock: 0, exact_stock: 0, in_stock: false }
            : null
          setProducts(prev =>
            prev.map(item =>
              item.id === productId
                ? { ...item, stock: 0, exact_stock: 0, in_stock: false }
                : item
            )
          )
          setPreviewProduct(prev =>
            prev && prev.id === productId
              ? { ...prev, stock: 0, exact_stock: 0, in_stock: false }
              : prev
          )
          return {
            ok: true,
            found: Boolean(payload.found),
            available: false,
            exactStockKnown: true,
            stock: 0,
            inStock: false,
            product: markedUnavailable,
            errorMessage: payload.reason ? String(payload.reason) : undefined,
          }
        }

        const liveStock = Math.max(0, Number(payload.stock) || 0)
        const liveInStock = Boolean(payload.in_stock) && liveStock > 0
        const nextVariants =
          payload.variants !== undefined
            ? normalizeProductVariants(payload.variants as ProductVariant[])
            : existingProd?.variants

        const updatedProduct: PublicProduct | null = existingProd
          ? {
              ...existingProd,
              unit: typeof payload.unit === 'string' && payload.unit ? payload.unit : existingProd.unit,
              stock: showStock ? liveStock : liveInStock ? 1 : 0,
              exact_stock: liveStock,
              in_stock: liveInStock,
              variants: nextVariants,
            }
          : null

        if (updatedProduct) {
          setProducts(prev => prev.map(item => (item.id === productId ? updatedProduct : item)))
          setPreviewProduct(prev =>
            prev && prev.id === productId ? updatedProduct : prev
          )
        }

        return {
          ok: true,
          found: true,
          available: true,
          exactStockKnown: true,
          stock: liveStock,
          inStock: liveInStock,
          product: updatedProduct,
        }
      }

      if (
        error &&
        /verificar_stock_catalogo_publico|does not exist|schema cache|42883|PGRST202/i.test(
          `${error.message || ''} ${error.code || ''}`
        )
      ) {
        verifyRpcSupportedRef.current = false
      }
    }

    // 2. Respaldo universal contra Supabase (resolver_catalogo_publico / obtener_catalogo_publico + lectura directa)
    const [catalogRpcRaw, directRow] = await Promise.all([
      supabase.rpc('resolver_catalogo_publico', { p_slug_or_id: companyId }),
      targetUuid
        ? supabase
            .from('products')
            .select('id, stock, unit, catalog_visible, variants')
            .eq('company_id', targetUuid)
            .eq('id', productId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    const catalogRpc =
      catalogRpcRaw.error && targetUuid
        ? await supabase.rpc('obtener_catalogo_publico', { p_company_id: targetUuid })
        : catalogRpcRaw

    if (catalogRpc.error) {
      return {
        ok: false,
        found: false,
        available: false,
        exactStockKnown: false,
        stock: 0,
        inStock: false,
        product: existingProd,
        errorMessage:
          'No pudimos verificar el inventario en tiempo real con Supabase. Revisa tu conexión e inténtalo de nuevo.',
      }
    }

    const catPayload = catalogRpc.data as Record<string, unknown> | null
    if (!catPayload?.available) {
      return {
        ok: true,
        found: false,
        available: false,
        exactStockKnown: true,
        stock: 0,
        inStock: false,
        product: null,
        errorMessage: String(
          catPayload?.reason || 'Este catálogo comercial no está disponible en este momento.'
        ),
      }
    }

    const freshComp = catPayload.company as PublicCompanyInfo
    const directData =
      !directRow.error && directRow.data ? (directRow.data as Record<string, unknown>) : null

    const refreshedProducts: PublicProduct[] = ((catPayload.products || []) as PublicProduct[]).map(
      rawProd => {
        const prevMatch = productsRef.current.find(x => x.id === rawProd.id)
        const isTarget = rawProd.id === productId
        let exactStock: number | null = freshComp.show_stock
          ? Math.max(0, Number(rawProd.stock) || 0)
          : !rawProd.in_stock
            ? 0
            : prevMatch?.exact_stock ?? null

        if (isTarget && directData) {
          exactStock =
            directData.catalog_visible === false
              ? 0
              : Math.max(0, Number(directData.stock) || 0)
        }

        const effectiveInStock =
          typeof exactStock === 'number' ? exactStock > 0 : Boolean(rawProd.in_stock)

        return {
          ...rawProd,
          exact_stock: exactStock,
          in_stock: effectiveInStock,
          variants:
            isTarget && directData?.variants !== undefined
              ? normalizeProductVariants(directData.variants as ProductVariant[])
              : normalizeProductVariants(rawProd.variants),
        }
      }
    )

    setCompany(freshComp)
    setProducts(refreshedProducts)

    const targetUpdated = refreshedProducts.find(x => x.id === productId) || null
    setPreviewProduct(prev => {
      if (!prev) return null
      return refreshedProducts.find(x => x.id === prev.id) || prev
    })

    if (!targetUpdated || directData?.catalog_visible === false) {
      return {
        ok: true,
        found: false,
        available: false,
        exactStockKnown: true,
        stock: 0,
        inStock: false,
        product: null,
      }
    }

    const exactKnown =
      typeof targetUpdated.exact_stock === 'number' &&
      Number.isFinite(targetUpdated.exact_stock)
    const liveStock = exactKnown
      ? Math.max(0, Number(targetUpdated.exact_stock) || 0)
      : targetUpdated.in_stock
        ? 1
        : 0

    return {
      ok: true,
      found: true,
      available: true,
      exactStockKnown: exactKnown,
      stock: liveStock,
      inStock: exactKnown ? liveStock > 0 : Boolean(targetUpdated.in_stock),
      product: targetUpdated,
    }
  }

  function setLineQtyImmediate(
    p: PublicProduct,
    variant: ProductVariant | null,
    nextQty: number
  ) {
    const key = cartKeyOf(p.id, variant?.id)
    setCartQtyDraftByKey(prev => {
      if (!(key in prev)) return prev
      const copy = { ...prev }
      delete copy[key]
      return copy
    })
    setCart(prev => {
      const maxAllowed = getMaxQtyForVariant(p, variant, prev)
      const clamped = Math.max(0, Math.min(maxAllowed, Math.round(nextQty * 100) / 100))
      const copy = { ...prev }
      if (clamped <= 0) delete copy[key]
      else copy[key] = clamped
      return copy
    })
    if (stockAlert?.productId === p.id) {
      dismissStockAlert()
    }
  }

  async function setLineQty(
    p: PublicProduct,
    variant: ProductVariant | null,
    nextQty: number
  ) {
    const key = cartKeyOf(p.id, variant?.id)
    setCartQtyDraftByKey(prev => {
      if (!(key in prev)) return prev
      const copy = { ...prev }
      delete copy[key]
      return copy
    })

    const desiredQty = round2(Math.max(0, Number(nextQty) || 0))
    const currentQty = cartRef.current[key] || 0

    // Disminuir o quitar del carrito es inmediato sin latencia de red
    if (desiredQty <= currentQty) {
      setLineQtyImmediate(p, variant, desiredQty)
      return
    }

    if (inFlightProdRef.current[p.id]) return
    inFlightProdRef.current[p.id] = true
    setVerifyingByProd(prev => ({ ...prev, [p.id]: true }))

    try {
      const otherReserved = getReservedBaseByOtherVariants(p, variant?.id, cartRef.current)
      const mult =
        variant?.stock_multiplier && variant.stock_multiplier > 0 ? variant.stock_multiplier : 1
      const neededBase = otherReserved + desiredQty * mult

      const check = await verifyLiveProductStock(p.id, neededBase)
      if (!check.ok) {
        emitStockAlert({
          productId: p.id,
          variantId: variant?.id || null,
          title: 'No se pudo verificar el stock en tiempo real',
          message:
            check.errorMessage ||
            'No fue posible consultar el inventario en Supabase. Inténtalo de nuevo.',
          availableUnits: null,
          requestedUnits: desiredQty,
          canQuickAddAvailable: false,
        })
        return
      }

      if (!check.found || !check.available || !check.product) {
        setCart(prev => {
          const copy = { ...prev }
          delete copy[key]
          return copy
        })
        emitStockAlert({
          productId: p.id,
          variantId: variant?.id || null,
          title: 'Producto ya no disponible',
          message: `«${p.name}» acaba de agotarse o retirarse del catálogo en tiempo real.`,
          availableUnits: 0,
          requestedUnits: desiredQty,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveProd = check.product
      const liveVariant = variant
        ? (liveProd.variants || []).find(v => v.id === variant.id && v.available !== false) ||
          null
        : null

      if (variant && !liveVariant) {
        setCart(prev => {
          const copy = { ...prev }
          delete copy[key]
          return copy
        })
        emitStockAlert({
          productId: liveProd.id,
          variantId: variant.id,
          title: 'Presentación sin disponibilidad',
          message: `La presentación «${variant.label}» de «${liveProd.name}» ya no está disponible en inventario.`,
          availableUnits: 0,
          requestedUnits: desiredQty,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveOtherReserved = getReservedBaseByOtherVariants(
        liveProd,
        liveVariant?.id,
        cartRef.current
      )
      const liveMaxUnits = !check.inStock
        ? 0
        : check.exactStockKnown
          ? getMaxQtyForVariant(liveProd, liveVariant, cartRef.current)
          : 9999

      if (desiredQty > liveMaxUnits) {
        if (currentQty > liveMaxUnits) {
          setCart(prev => {
            const copy = { ...prev }
            if (liveMaxUnits <= 0) delete copy[key]
            else copy[key] = liveMaxUnits
            return copy
          })
        }
        emitStockAlert(
          buildInsufficientStockNotice(
            liveProd,
            liveVariant,
            desiredQty,
            liveMaxUnits,
            check.stock,
            liveOtherReserved,
            currentQty === 0 && liveMaxUnits > 0
          )
        )
        return
      }

      setCart(prev => ({
        ...prev,
        [key]: desiredQty,
      }))
      if (stockAlert?.productId === liveProd.id) {
        dismissStockAlert()
      }
    } finally {
      inFlightProdRef.current[p.id] = false
      setVerifyingByProd(prev => ({ ...prev, [p.id]: false }))
    }
  }

  async function changeLineVariant(
    p: PublicProduct,
    fromVariant: ProductVariant | null,
    toVariantId: string
  ) {
    const availVars = (p.variants || []).filter(v => v.available !== false)
    const targetCandidate = availVars.find(v => v.id === toVariantId) || null
    const oldKey = cartKeyOf(p.id, fromVariant?.id)
    const newKey = cartKeyOf(p.id, targetCandidate?.id)
    if (oldKey === newKey) return

    const movingQty = cartRef.current[oldKey] || 0
    if (movingQty <= 0) return

    if (inFlightProdRef.current[p.id]) return
    inFlightProdRef.current[p.id] = true
    setVerifyingByProd(prev => ({ ...prev, [p.id]: true }))

    try {
      const withoutOldSnapshot = { ...cartRef.current }
      delete withoutOldSnapshot[oldKey]
      const targetMult =
        targetCandidate?.stock_multiplier && targetCandidate.stock_multiplier > 0
          ? targetCandidate.stock_multiplier
          : 1
      const otherReserved = getReservedBaseByOtherVariants(
        p,
        targetCandidate?.id,
        withoutOldSnapshot
      )
      const combinedDesired = round2((withoutOldSnapshot[newKey] || 0) + movingQty)

      const check = await verifyLiveProductStock(
        p.id,
        otherReserved + combinedDesired * targetMult
      )
      if (!check.ok || !check.found || !check.available || !check.product) {
        emitStockAlert({
          productId: p.id,
          variantId: targetCandidate?.id || null,
          title: 'No se pudo cambiar la presentación',
          message:
            check.errorMessage ||
            `«${p.name}» no cuenta con disponibilidad suficiente en tiempo real.`,
          availableUnits: 0,
          requestedUnits: combinedDesired,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveProd = check.product
      const liveTarget = targetCandidate
        ? (liveProd.variants || []).find(
            v => v.id === targetCandidate.id && v.available !== false
          ) || null
        : null

      if (targetCandidate && !liveTarget) {
        emitStockAlert({
          productId: liveProd.id,
          variantId: targetCandidate.id,
          title: 'Presentación no disponible',
          message: `La presentación «${targetCandidate.label}» de «${liveProd.name}» acaba de agotarse.`,
          availableUnits: 0,
          requestedUnits: combinedDesired,
          canQuickAddAvailable: false,
        })
        return
      }

      const latestWithoutOld = { ...cartRef.current }
      delete latestWithoutOld[oldKey]
      const maxAllowed = !check.inStock
        ? 0
        : check.exactStockKnown
          ? getMaxQtyForVariant(liveProd, liveTarget, latestWithoutOld)
          : 9999

      if (combinedDesired > maxAllowed) {
        emitStockAlert(
          buildInsufficientStockNotice(
            liveProd,
            liveTarget,
            combinedDesired,
            maxAllowed,
            check.stock,
            getReservedBaseByOtherVariants(liveProd, liveTarget?.id, latestWithoutOld),
            false
          )
        )
        return
      }

      if (liveTarget) {
        setSelectedVariantByProd(prev => ({ ...prev, [liveProd.id]: liveTarget.id }))
      }

      setCart(prev => {
        const currentMoving = prev[oldKey] || 0
        if (currentMoving <= 0) return prev
        const withoutOld = { ...prev }
        delete withoutOld[oldKey]
        const combined = round2((withoutOld[newKey] || 0) + currentMoving)
        const clamped = Math.max(0, Math.min(maxAllowed, combined))

        const ordered: Record<string, number> = {}
        let placed = false
        for (const [k, v] of Object.entries(prev)) {
          if (k === oldKey) {
            if (!(newKey in prev) && clamped > 0) {
              ordered[newKey] = clamped
              placed = true
            }
            continue
          }
          if (k === newKey) {
            if (clamped > 0) {
              ordered[newKey] = clamped
              placed = true
            }
            continue
          }
          ordered[k] = v
        }
        if (!placed && clamped > 0) {
          ordered[newKey] = clamped
        }
        return ordered
      })

      if (stockAlert?.productId === liveProd.id) {
        dismissStockAlert()
      }
    } finally {
      inFlightProdRef.current[p.id] = false
      setVerifyingByProd(prev => ({ ...prev, [p.id]: false }))
    }
  }

  async function addAnotherVariantToCart(p: PublicProduct) {
    if (inFlightProdRef.current[p.id]) return
    inFlightProdRef.current[p.id] = true
    setVerifyingByProd(prev => ({ ...prev, [p.id]: true }))

    try {
      const check = await verifyLiveProductStock(p.id, 1)
      if (!check.ok || !check.found || !check.available || !check.product) {
        emitStockAlert({
          productId: p.id,
          variantId: null,
          title: 'Sin stock adicional disponible',
          message:
            check.errorMessage ||
            `«${p.name}» no cuenta con unidades adicionales disponibles en inventario.`,
          availableUnits: 0,
          requestedUnits: 1,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveProd = check.product
      const availVars = (liveProd.variants || []).filter(v => v.available !== false)
      const unaddedVars = availVars.filter(v => !(cartRef.current[cartKeyOf(liveProd.id, v.id)] > 0))
      const candidate = unaddedVars.find(v => {
        const maxForCandidate = !check.inStock
          ? 0
          : check.exactStockKnown
            ? getMaxQtyForVariant(liveProd, v, cartRef.current)
            : 9999
        return maxForCandidate >= 1
      })

      if (!candidate) {
        const attemptedVar = unaddedVars[0] || null
        emitStockAlert(
          buildInsufficientStockNotice(
            liveProd,
            attemptedVar,
            1,
            0,
            check.stock,
            getReservedBaseByOtherVariants(liveProd, attemptedVar?.id, cartRef.current),
            false
          )
        )
        return
      }

      setSelectedVariantByProd(prev => ({ ...prev, [liveProd.id]: candidate.id }))
      const targetKey = cartKeyOf(liveProd.id, candidate.id)
      setCart(prev => ({
        ...prev,
        [targetKey]: 1,
      }))
      if (stockAlert?.productId === liveProd.id) {
        dismissStockAlert()
      }
    } finally {
      inFlightProdRef.current[p.id] = false
      setVerifyingByProd(prev => ({ ...prev, [p.id]: false }))
    }
  }

  function openCartDrawer(step: 'cart' | 'checkout' = 'cart') {
    setConfirmClearCart(false)
    setSubmitError(null)
    setCartStep(step)
    setDrawerOpen(true)
  }

  async function handleProceedToCheckout() {
    if (cartLines.length === 0 || verifyingCheckoutStock) return
    setVerifyingCheckoutStock(true)
    setSubmitError(null)

    try {
      const uniqueProdIds = Array.from(new Set(cartLines.map(l => l.product.id)))
      const results = await Promise.all(
        uniqueProdIds.map(pid => {
          const totalBaseNeeded = cartLines
            .filter(l => l.product.id === pid)
            .reduce((acc, l) => acc + l.qty * l.stockMultiplier, 0)
          return verifyLiveProductStock(pid, totalBaseNeeded)
        })
      )

      const failedNetwork = results.find(r => !r.ok)
      if (failedNetwork) {
        emitStockAlert({
          productId: uniqueProdIds[0],
          variantId: null,
          title: 'Verificación de inventario pendiente',
          message:
            failedNetwork.errorMessage ||
            'No pudimos confirmar el stock en tiempo real antes de pasar al pago.',
          availableUnits: null,
          requestedUnits: 1,
          canQuickAddAvailable: false,
        })
        setCartStep('cart')
        return
      }

      // Validar que el carrito completo cumple con el inventario real de Supabase
      const liveProductsList = productsRef.current
      const reconciled = reconcilePersistedCartWithCatalog({
        savedItems: cartRef.current,
        savedVariants: selectedVariantsRef.current,
        snapshots: snapshotsRef.current,
        products: liveProductsList.map(lp => ({
          ...lp,
          stock:
            typeof lp.exact_stock === 'number'
              ? lp.exact_stock
              : Number(lp.stock) || 0,
        })),
        showStock: liveProductsList.every(
          lp => typeof lp.exact_stock === 'number' || Boolean(companyRef.current?.show_stock)
        ),
      })

      if (reconciled.notices.length > 0) {
        setCart(reconciled.nextItems)
        setSelectedVariantByProd(reconciled.nextSelectedVariants)
        setCartReconcileNotices(reconciled.notices)
        setCartStep('cart')
        emitStockAlert({
          productId: uniqueProdIds[0],
          variantId: null,
          title: 'Actualización de stock en tiempo real',
          message: reconciled.notices[0],
          availableUnits: null,
          requestedUnits: 1,
          canQuickAddAvailable: false,
        })
        return
      }

      setCartStep('checkout')
    } finally {
      setVerifyingCheckoutStock(false)
    }
  }

  function handleClearCart() {
    snapshotsRef.current = {}
    setCart({})
    setCartQtyDraftByKey({})
    setCartStep('cart')
    setConfirmClearCart(false)
    setCartReconcileNotices([])
    dismissStockAlert()
  }

  async function handleQuickAddFromCard(
    p: PublicProduct,
    variant: ProductVariant | null,
    qty: number,
    opts?: { forceClampToAvailable?: boolean }
  ) {
    if (inFlightProdRef.current[p.id]) return
    const requestedQty = round2(Math.max(1, Number(qty) || 1))
    const otherReserved = getReservedBaseByOtherVariants(p, variant?.id, cartRef.current)
    const mult =
      variant?.stock_multiplier && variant.stock_multiplier > 0 ? variant.stock_multiplier : 1
    const neededBase = otherReserved + requestedQty * mult

    inFlightProdRef.current[p.id] = true
    setVerifyingByProd(prev => ({ ...prev, [p.id]: true }))

    try {
      const check = await verifyLiveProductStock(p.id, neededBase)
      if (!check.ok) {
        emitStockAlert({
          productId: p.id,
          variantId: variant?.id || null,
          title: 'No se pudo verificar disponibilidad',
          message:
            check.errorMessage ||
            'Error de conexión al consultar el stock en tiempo real desde Supabase.',
          availableUnits: null,
          requestedUnits: requestedQty,
          canQuickAddAvailable: false,
        })
        return
      }

      if (!check.found || !check.available || !check.product) {
        emitStockAlert({
          productId: p.id,
          variantId: variant?.id || null,
          title: 'Producto no disponible',
          message: `«${p.name}» ya no cuenta con existencias disponibles en el catálogo.`,
          availableUnits: 0,
          requestedUnits: requestedQty,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveProd = check.product
      const liveVariant = variant
        ? (liveProd.variants || []).find(v => v.id === variant.id && v.available !== false) ||
          null
        : null

      if (variant && !liveVariant) {
        emitStockAlert({
          productId: liveProd.id,
          variantId: variant.id,
          title: 'Presentación agotada',
          message: `La presentación «${variant.label}» de «${liveProd.name}» dejó de estar disponible en tiempo real.`,
          availableUnits: 0,
          requestedUnits: requestedQty,
          canQuickAddAvailable: false,
        })
        return
      }

      const liveOtherReserved = getReservedBaseByOtherVariants(
        liveProd,
        liveVariant?.id,
        cartRef.current
      )
      const liveMaxUnits = !check.inStock
        ? 0
        : check.exactStockKnown
          ? getMaxQtyForVariant(liveProd, liveVariant, cartRef.current)
          : 9999

      setPendingDraftByProd(prev => {
        if (!(liveProd.id in prev)) return prev
        const copy = { ...prev }
        delete copy[liveProd.id]
        return copy
      })

      if (requestedQty > liveMaxUnits || liveMaxUnits <= 0) {
        if (liveMaxUnits > 0) {
          setPendingQtyByProd(prev => ({ ...prev, [liveProd.id]: liveMaxUnits }))
        }

        if (opts?.forceClampToAvailable && liveMaxUnits > 0) {
          const clampedKey = cartKeyOf(liveProd.id, liveVariant?.id)
          setCart(prev => ({
            ...prev,
            [clampedKey]: liveMaxUnits,
          }))
          setPendingQtyByProd(prev => {
            const copy = { ...prev }
            delete copy[liveProd.id]
            return copy
          })
          dismissStockAlert()
          setJustAddedKey(clampedKey)
          if (addedTimerRef.current !== null) {
            window.clearTimeout(addedTimerRef.current)
          }
          addedTimerRef.current = window.setTimeout(() => {
            setJustAddedKey(curr => (curr === clampedKey ? null : curr))
          }, 1300)
          return
        }

        emitStockAlert(
          buildInsufficientStockNotice(
            liveProd,
            liveVariant,
            requestedQty,
            liveMaxUnits,
            check.stock,
            liveOtherReserved,
            liveMaxUnits > 0
          )
        )
        return
      }

      const key = cartKeyOf(liveProd.id, liveVariant?.id)
      setCart(prev => ({
        ...prev,
        [key]: requestedQty,
      }))
      setPendingQtyByProd(prev => {
        if (!(liveProd.id in prev)) return prev
        const copy = { ...prev }
        delete copy[liveProd.id]
        return copy
      })
      if (stockAlert?.productId === liveProd.id) {
        dismissStockAlert()
      }
      setJustAddedKey(key)
      if (addedTimerRef.current !== null) {
        window.clearTimeout(addedTimerRef.current)
      }
      addedTimerRef.current = window.setTimeout(() => {
        setJustAddedKey(curr => (curr === key ? null : curr))
      }, 1300)
    } finally {
      inFlightProdRef.current[p.id] = false
      setVerifyingByProd(prev => ({ ...prev, [p.id]: false }))
    }
  }

  const cartLines = useMemo(() => {
    const out: {
      key: string
      product: PublicProduct
      variant: ProductVariant | null
      qty: number
      unitPrice: number
      regularPrice: number
      wholesalePriceCandidate: number
      isWholesale: boolean
      stockMultiplier: number
      subtotal: number
    }[] = []

    for (const [key, qty] of Object.entries(cart)) {
      if (qty <= 0) continue
      const { productId: pid, variantId: vid } = parseCartKey(key)
      const p = products.find(x => x.id === pid)
      if (!p) continue
      const variant = vid ? (p.variants || []).find(v => v.id === vid) || null : null

      const basePrice = variant ? Number(variant.price) : Number(p.price)
      const wholesaleCandidate = variant
        ? Number(variant.price_wholesale || 0)
        : Number(p.price_wholesale || 0)

      const qualifiesWholesale =
        Boolean(company?.show_wholesale) &&
        wholesaleCandidate > 0 &&
        Number(p.wholesale_min_qty) > 0 &&
        qty >= Number(p.wholesale_min_qty)

      const unitPrice = qualifiesWholesale ? wholesaleCandidate : basePrice
      out.push({
        key,
        product: p,
        variant,
        qty,
        unitPrice,
        regularPrice: basePrice,
        wholesalePriceCandidate: wholesaleCandidate,
        isWholesale: qualifiesWholesale,
        stockMultiplier: variant?.stock_multiplier || 1,
        subtotal: round2(unitPrice * qty),
      })
    }
    return out
  }, [cart, products, company?.show_wholesale])

  // Persistir automáticamente en localStorage cada cambio del carrito, variantes y borrador de pago
  useEffect(() => {
    if (hydratedCompanyRef.current !== companyId) return
    if (skipNextStorageWriteRef.current) {
      skipNextStorageWriteRef.current = false
      return
    }

    const mergedSnapshots: Record<string, CartLineSnapshot> = { ...snapshotsRef.current }
    for (const line of cartLines) {
      mergedSnapshots[line.key] = {
        productName: line.product.name,
        variantLabel: line.variant?.label || null,
        unitPrice: line.unitPrice,
      }
    }
    snapshotsRef.current = mergedSnapshots

    writePersistedCart(companyId, {
      items: cart,
      selectedVariants: selectedVariantByProd,
      snapshots: mergedSnapshots,
      checkoutDraft: {
        step: Object.keys(cart).length > 0 ? cartStep : 'cart',
        deliveryMode,
        selectedPaymentId,
        paymentReference,
        paymentSenderBank,
        paymentAmountInput,
        notes,
        paymentProofUrl,
      },
    })
  }, [
    companyId,
    cart,
    cartLines,
    selectedVariantByProd,
    cartStep,
    deliveryMode,
    selectedPaymentId,
    paymentReference,
    paymentSenderBank,
    paymentAmountInput,
    notes,
    paymentProofUrl,
  ])

  const totalItemsCount = useMemo(
    () => round2(cartLines.reduce((acc, l) => acc + l.qty, 0)),
    [cartLines]
  )

  const wholesaleSavings = useMemo(
    () =>
      round2(
        cartLines.reduce(
          (acc, l) => acc + Math.max(0, (l.regularPrice - l.unitPrice) * l.qty),
          0
        )
      ),
    [cartLines]
  )

  const totals = useMemo(() => {
    const sum = round2(cartLines.reduce((acc, l) => acc + l.subtotal, 0))
    const mode: TaxMode =
      company?.tax_mode === 'adicional' || company?.tax_mode === 'incluido'
        ? company.tax_mode
        : 'none'
    return calcTax(sum, mode, Number(company?.tax_rate) || 0)
  }, [cartLines, company])

  // Moneda secundaria de referencia para el pago (ej. VES o COP)
  const primaryLocalFxCode = useMemo(() => {
    if (displayFxCode !== 'BASE' && activeFxRate > 0) return displayFxCode
    return availableFxCodes[0] || null
  }, [displayFxCode, activeFxRate, availableFxCodes])

  const fxEquivalentTotal = useMemo(() => {
    if (!primaryLocalFxCode) return null
    const rate = Number(fxMap[primaryLocalFxCode]) || 0
    if (!(rate > 0)) return null
    const isLocalPerUsd =
      baseCur === 'USD' &&
      ['VES', 'COP', 'ARS', 'CLP', 'MXN', 'PEN', 'BRL'].includes(primaryLocalFxCode) &&
      rate > 1.5
    const amount = isLocalPerUsd ? round2(totals.total * rate) : round2(totals.total / rate)
    return {
      code: primaryLocalFxCode,
      rate,
      amount,
      formatted: formatMoney(amount, primaryLocalFxCode),
    }
  }, [primaryLocalFxCode, fxMap, baseCur, totals.total])

  async function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !company) return
    setUploadingProof(true)
    setSubmitError(null)
    try {
      const uploaded = await uploadCatalogAssetOrInline(file, 'receipt', company.company_id)
      setPaymentProofUrl(uploaded)
      if (!paymentAmountInput) {
        setPaymentAmountInput(String(totals.total))
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'No se pudo adjuntar el capture del comprobante.'
      )
    } finally {
      setUploadingProof(false)
    }
  }

  async function handleCopyPaymentDetails() {
    if (!currentPaymentConfig || !company) return
    const text = [
      `${company.name} — ${currentPaymentConfig.label}`,
      currentPaymentConfig.bank_or_platform && `Banco / Plataforma: ${currentPaymentConfig.bank_or_platform}`,
      currentPaymentConfig.account_or_phone && `Cuenta / Teléfono: ${currentPaymentConfig.account_or_phone}`,
      currentPaymentConfig.holder_name && `Titular: ${currentPaymentConfig.holder_name}`,
      currentPaymentConfig.holder_document && `RIF / Documento: ${currentPaymentConfig.holder_document}`,
      `Monto total: ${money(totals.total)}${fxEquivalentTotal ? ` (${fxEquivalentTotal.formatted})` : ''}`,
    ]
      .filter(Boolean)
      .join('\n')
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopiedPayData(true)
      window.setTimeout(() => setCopiedPayData(false), 2400)
    }
  }

  async function handleSubmitOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!company || cartLines.length === 0 || submitting) return

    if (customerType === 'juridica' && !documentId.trim()) {
      setSubmitError('Ingresa el RIF / NIT / RUT de la empresa para procesar compras jurídicas.')
      return
    }

    if (deliveryMode !== 'pickup' && !address.trim()) {
      setSubmitError('Indica la dirección exacta de entrega o ciudad de destino.')
      return
    }

    if (currentPaymentConfig?.requires_proof && !paymentProofUrl) {
      setSubmitError(
        `Adjunta el capture o pantallazo de tu recibo de ${currentPaymentConfig.label} para que el equipo corrobore tu pago.`
      )
      return
    }

    setSubmitError(null)
    setSubmitting(true)

    saveBuyerCache({
      customerType,
      customerName: customerName.trim(),
      documentId: documentId.trim(),
      contactPerson: contactPerson.trim(),
      requiresInvoice,
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
    })

    const reportedAmount =
      parseFloat(String(paymentAmountInput).replace(',', '.')) || totals.total

    const itemsPayload = cartLines.map(l => ({
      product_id: l.product.id,
      product_name: l.product.name,
      sku: l.product.sku,
      variant_id: l.variant?.id || null,
      variant_label: l.variant?.label || null,
      stock_multiplier: l.stockMultiplier,
      quantity: l.qty,
      unit_price: l.unitPrice,
      subtotal: l.subtotal,
      unit: l.product.unit,
      image_url: l.product.image_url || null,
    }))

    let { data, error } = await supabase.rpc('crear_pedido_catalogo_publico', {
      p_company_id: company.company_id,
      p_customer_name: customerName.trim(),
      p_phone: phone.trim(),
      p_document: documentId.trim() || null,
      p_address: deliveryMode === 'pickup' ? 'Retiro en sede' : address.trim() || null,
      p_notes: notes.trim() || null,
      p_items: itemsPayload,
      p_customer_type: customerType,
      p_contact_person: customerType === 'juridica' ? contactPerson.trim() || null : null,
      p_requires_invoice: customerType === 'juridica' ? requiresInvoice : false,
      p_email: email.trim() || null,
      p_delivery_mode: deliveryMode,
      p_payment_method: currentPaymentConfig?.id || selectedPaymentId,
      p_payment_reference: paymentReference.trim() || null,
      p_payment_bank: paymentSenderBank.trim() || null,
      p_payment_amount: reportedAmount,
      p_payment_proof_url: paymentProofUrl,
      p_fx_currency: fxEquivalentTotal?.code || null,
      p_fx_rate: fxEquivalentTotal?.rate || null,
    })

    // Compatibilidad retroactiva únicamente para pedidos sin comprobante.
// La función antigua de 7 argumentos no puede guardar el soporte de pago.
if (error && /crear_pedido_catalogo_publico|function|schema cache/i.test(error.message || '')) {
  if (paymentProofUrl) {
    setSubmitting(false)
    setSubmitError(
      'No fue posible registrar el comprobante de pago. Tu pedido no se ha confirmado. El sistema necesita la versión actualizada del motor SQL para guardar el soporte de forma segura.'
    )
    return
  }
      const legacyNotes = [
        customerType === 'juridica' ? `[JURÍDICA RIF: ${documentId}]` : '',
        currentPaymentConfig ? `Pago: ${currentPaymentConfig.label}` : '',
        paymentReference ? `Ref: #${paymentReference}` : '',
        notes.trim(),
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 235)

      const fallbackRes = await supabase.rpc('crear_pedido_catalogo_publico', {
        p_company_id: company.company_id,
        p_customer_name: customerName.trim(),
        p_phone: phone.trim(),
        p_document: documentId.trim() || null,
        p_address: deliveryMode === 'pickup' ? 'Retiro en sede' : address.trim() || null,
        p_notes: legacyNotes || null,
        p_items: cartLines.map(l => ({
          product_id: l.product.id,
          quantity: round2(l.qty * l.stockMultiplier),
        })),
      })
      data = fallbackRes.data
      error = fallbackRes.error
    }

    setSubmitting(false)
    if (error) {
      setSubmitError(error.message)
      return
    }

    const res = data as OrderResult
    setConfirmedOrder({
      result: res,
      customerName: customerName.trim(),
      customerType,
      documentId: documentId.trim(),
      paymentLabel:
        currentPaymentConfig?.label ||
        PAYMENT_METHOD_LABELS[selectedPaymentId] ||
        selectedPaymentId,
      paymentReference: paymentReference.trim(),
      hasProof: Boolean(paymentProofUrl),
      lines: cartLines.map(l => ({
        name: l.product.name,
        variantLabel: l.variant?.label || null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
      })),
    })

    if (res.order_number) setTrackCode(res.order_number)
    if (res.tracking_pin) setTrackPin(res.tracking_pin)

    snapshotsRef.current = {}
    skipNextStorageWriteRef.current = true
    clearPersistedCart(companyId)
    clearPersistedCart(company.company_id)
    setCart({})
    setCartStep('cart')
    setConfirmClearCart(false)
    setCartReconcileNotices([])
    setNotes('')
    setPaymentAmountInput('')
    setPaymentReference('')
    setPaymentSenderBank('')
    setPaymentProofUrl(null)
    setDrawerOpen(false)
  }

  async function handleTrackOrder(e: React.FormEvent) {
    e.preventDefault()
    if (!company || !trackCode.trim() || !trackPin.trim()) return
    setTrackingLoading(true)
    setTrackError(null)
    setTrackedOrder(null)

    const { data, error } = await supabase.rpc('consultar_pedido_catalogo_publico', {
      p_company_id: company.company_id,
      p_order_number: trackCode.trim().toUpperCase(),
      p_pin_or_phone: trackPin.trim(),
    })

    setTrackingLoading(false)
    if (error) {
      setTrackError(
        /consultar_pedido_catalogo_publico|does not exist/i.test(error.message || '')
          ? 'El seguimiento en línea se habilitará cuando la empresa actualice el motor SQL de catálogo.'
          : error.message
      )
      return
    }

    const res = data as { found?: boolean; reason?: string; order?: TrackedOrderInfo } | null
    if (!res?.found || !res.order) {
      setTrackError(
        res?.reason ||
          'No encontramos un pedido con ese código y PIN / últimos 4 dígitos del teléfono.'
      )
      return
    }

    setTrackedOrder(res.order)
  }

  function handlePrintVoucher() {
    if (!confirmedOrder || !company) return
    const logoHtml = company.logo_url
      ? `<img src="${esc(company.logo_url)}" alt="" style="width:48px;height:48px;object-fit:contain;border-radius:8px;background:#fff;padding:4px;" />`
      : ''
    const rowsHtml = confirmedOrder.lines
      .map(
        l => `<tr>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;">
            <strong>${esc(l.name)}</strong>${l.variantLabel ? ` <span style="color:#475569;">(${esc(l.variantLabel)})</span>` : ''}
          </td>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${l.qty}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-variant-numeric:tabular-nums;">${esc(money(l.unitPrice))}</td>
          <td style="padding:7px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${esc(money(l.subtotal))}</td>
        </tr>`
      )
      .join('')

    printHtml(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"/><title>Comprobante ${esc(confirmedOrder.result.order_number)}</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; font-size: 12px; margin: 0; }
  .head { background: ${brand.hex}; color: #fff; border-radius: 12px; padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style></head><body>
  <div class="head">
    <div style="display:flex;align-items:center;gap:12px;">
      ${logoHtml}
      <div>
        <div style="font-size:16px;font-weight:800;">${esc(company.name)}</div>
        <div style="font-size:11px;opacity:0.9;">${esc(company.rif || '')} ${company.phone ? `· ${esc(company.phone)}` : ''}</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;text-transform:uppercase;opacity:0.85;">Orden de Compra Digital</div>
      <div style="font-size:18px;font-weight:800;">${esc(confirmedOrder.result.order_number)}</div>
      ${confirmedOrder.result.tracking_pin ? `<div style="font-size:11px;">PIN Seguimiento: ${esc(confirmedOrder.result.tracking_pin)}</div>` : ''}
    </div>
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;gap:16px;">
    <div>
      <div><strong>Comprador:</strong> ${esc(confirmedOrder.customerName)} (${confirmedOrder.customerType === 'juridica' ? 'Persona Jurídica' : 'Persona Natural'})</div>
      ${confirmedOrder.documentId ? `<div><strong>Documento / RIF:</strong> ${esc(confirmedOrder.documentId)}</div>` : ''}
    </div>
    <div style="text-align:right;">
      <div><strong>Medio de pago:</strong> ${esc(confirmedOrder.paymentLabel)}</div>
      ${confirmedOrder.paymentReference ? `<div><strong>Referencia:</strong> #${esc(confirmedOrder.paymentReference)}</div>` : ''}
      <div><strong>Estado de pago:</strong> ${confirmedOrder.hasProof ? 'Capture adjunto en verificación' : 'Pendiente al recibir'}</div>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <thead>
      <tr style="background:#f1f5f9;text-align:left;font-size:11px;color:#475569;">
        <th style="padding:8px;">Producto / Cualidad</th>
        <th style="padding:8px;text-align:right;">Cant.</th>
        <th style="padding:8px;text-align:right;">Unitario</th>
        <th style="padding:8px;text-align:right;">Subtotal</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div style="text-align:right;font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;">
    Total orden: ${esc(money(confirmedOrder.result.total))}
  </div>
</body></html>`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <p className="text-sm text-slate-500">Cargando catálogo comercial...</p>
      </div>
    )
  }

  if (unavailableReason || !company) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 p-6 text-center space-y-3">
          <h1 className="text-lg font-bold text-slate-900">Catálogo no disponible</h1>
          <p className="text-sm text-slate-500">{unavailableReason}</p>
          {onExitPreview && (
            <button
              type="button"
              onClick={onExitPreview}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium whitespace-nowrap"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver al panel
            </button>
          )}
        </div>
      </div>
    )
  }

  const lightboxVariant = previewProduct ? getActiveVariant(previewProduct) : null
  const lightboxDisplayPrice = previewProduct
    ? formatDisplayPrice(lightboxVariant ? lightboxVariant.price : previewProduct.price)
    : null

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: estrictamente 3 zonas en una sola fila con identidad de marca */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          {/* Zona 1: Marca (Logo + Nombre en una sola línea) */}
          <button
            type="button"
            onClick={() => {
              setActiveView('store')
              setSelectedCategory('all')
              setConfirmedOrder(null)
            }}
            className="flex items-center gap-2.5 min-w-0 whitespace-nowrap shrink-0 text-left focus:outline-none"
          >
            {company.logo_url ? (
              <img
                src={company.logo_url}
                alt={company.name}
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white p-0.5 shrink-0"
              />
            ) : (
              <span
                className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${brand.primaryBtn}`}
              >
                {company.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate max-w-[170px] sm:max-w-xs">
              {company.name}
            </span>
          </button>

          {/* Zona 2: 4–5 enlaces limpios de navegación en una línea */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={() => {
                setActiveView('store')
                setSelectedCategory('all')
                setConfirmedOrder(null)
              }}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'store' && selectedCategory === 'all'
                  ? 'text-slate-900 underline underline-offset-4'
                  : ''
              }`}
            >
              Catálogo
            </button>
            {categories.slice(0, 3).map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setActiveView('store')
                  setSelectedCategory(cat.id)
                  setConfirmedOrder(null)
                }}
                className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                  activeView === 'store' && selectedCategory === cat.id
                    ? 'text-slate-900 underline underline-offset-4'
                    : ''
                }`}
              >
                {cat.name}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setActiveView('track')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
                activeView === 'track' ? 'text-slate-900 underline underline-offset-4' : ''
              }`}
            >
              Rastrear pedido
            </button>
          </nav>

          {/* Zona 3: 1 acción primaria */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => openCartDrawer('cart')}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${brand.primaryBtn}`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              Carrito ({totalItemsCount})
            </button>
          </div>
        </div>
      </header>

      {/* Franja contextual sutil sólo cuando el personal interno previsualiza el catálogo */}
      {onExitPreview && (
        <div className="bg-slate-900 text-slate-200 border-b border-slate-800 px-4 py-2 text-xs">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span>
              Vista previa en vivo del portal de clientes · Prueba elegir presentaciones y subir un capture de pago.
            </span>
            <div className="flex items-center gap-3">
              {onOpenCatalogOrders && (
                <button
                  type="button"
                  onClick={onOpenCatalogOrders}
                  className="font-semibold text-emerald-400 hover:text-emerald-300 underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                  Ir a bandeja de corroboración de pagos
                </button>
              )}
              <button
                type="button"
                onClick={onExitPreview}
                className="inline-flex items-center gap-1 font-semibold text-white hover:text-slate-200 whitespace-nowrap shrink-0"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Volver al sistema
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vista de Rastreo de Pedido en Vivo */}
      {activeView === 'track' ? (
        <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-10 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Consultar estado de mi compra
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Verifica en tiempo real si administración ya corroboró tu capture de pago y el estado de despacho.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveView('store')}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Ver productos
              </button>
            </div>

            <form onSubmit={handleTrackOrder} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Número de orden *
                </label>
                <input
                  required
                  value={trackCode}
                  onChange={e => setTrackCode(e.target.value)}
                  placeholder="Ej. WEB-1042"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm uppercase font-mono tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  PIN o últimos 4 dígitos tel. *
                </label>
                <input
                  required
                  value={trackPin}
                  onChange={e => setTrackPin(e.target.value)}
                  placeholder="Ej. 0140"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm font-mono tabular-nums"
                />
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  disabled={trackingLoading}
                  className={`w-full py-2 px-4 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${brand.primaryBtn}`}
                >
                  {trackingLoading ? 'Consultando...' : 'Consultar estado'}
                </button>
              </div>
            </form>

            {trackError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3.5 py-2.5 text-xs text-red-700">
                {trackError}
              </div>
            )}

            {trackedOrder && (
              <div className="border-t border-slate-200 pt-5 space-y-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500">
                      {trackedOrder.customer_name} ·{' '}
                      {trackedOrder.customer_type === 'juridica' ? 'Persona Jurídica' : 'Persona Natural'}
                    </p>
                    <h2 className="text-lg font-bold text-slate-900 font-mono tabular-nums">
                      Orden {trackedOrder.order_number}
                    </h2>
                  </div>
                  <p className="text-lg font-bold text-slate-900 tabular-nums">
                    {formatMoney(trackedOrder.total, trackedOrder.currency || baseCur)}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
                    <span className="text-slate-500 block">Corroboración de pago</span>
                    <strong className={`text-sm block ${PAYMENT_STATUS_META[trackedOrder.payment_status]?.toneClass || 'text-slate-900'}`}>
                      {PAYMENT_STATUS_META[trackedOrder.payment_status]?.label || trackedOrder.payment_status}
                    </strong>
                    <span className="text-slate-500 block tabular-nums">
                      {PAYMENT_METHOD_LABELS[trackedOrder.payment_method] || trackedOrder.payment_method}
                      {trackedOrder.payment_reference ? ` · Ref. #${trackedOrder.payment_reference}` : ''}
                    </span>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-1">
                    <span className="text-slate-500 block">Estado logístico</span>
                    <strong className={`text-sm block ${ORDER_STATUS_META[trackedOrder.order_status]?.toneClass || 'text-slate-900'}`}>
                      {ORDER_STATUS_META[trackedOrder.order_status]?.label || trackedOrder.order_status}
                    </strong>
                    <span className="text-slate-500 block">
                      {DELIVERY_MODE_LABELS[trackedOrder.delivery_mode] || 'Despacho comercial'}
                    </span>
                  </div>
                </div>

                {trackedOrder.admin_notes && (
                  <div className="rounded-lg border border-slate-200 bg-white p-3.5 text-xs text-slate-700">
                    <strong className="text-slate-900 block mb-0.5">
                      Nota del equipo de {company.name}:
                    </strong>
                    {trackedOrder.admin_notes}
                  </div>
                )}

                <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden text-xs">
                  {trackedOrder.items.map((it, idx) => (
                    <div key={idx} className="px-3.5 py-2.5 flex items-center justify-between gap-3 tabular-nums">
                      <span className="text-slate-700 truncate">
                        {it.quantity} × {it.product_name}
                        {it.variant_label ? ` (${it.variant_label})` : ''}
                      </span>
                      <span className="font-semibold text-slate-900 shrink-0">
                        {formatMoney(it.subtotal, trackedOrder.currency || baseCur)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </main>
      ) : confirmedOrder ? (
        /* Pantalla de Confirmación de Compra con Comprobante y PIN */
        <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-10">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className={`px-6 py-5 ${brand.heroBanner}`}>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-300 shrink-0" />
                <div>
                  <p className="text-xs opacity-85">
                    {confirmedOrder.hasProof
                      ? 'Pedido y capture de pago recibidos para verificación'
                      : 'Solicitud de compra registrada correctamente'}
                  </p>
                  <h1 className="text-xl font-bold tracking-tight tabular-nums">
                    Orden {confirmedOrder.result.order_number}
                  </h1>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-5">
              <p className="text-sm text-slate-600 leading-relaxed">
                Gracias, <strong>{confirmedOrder.customerName}</strong>. El equipo administrativo de{' '}
                <strong>{confirmedOrder.result.company_name}</strong> revisará tu{' '}
                {confirmedOrder.hasProof ? 'capture de pago adjunto' : 'solicitud'} para corroborar la operación y alistar tu entrega.
              </p>

              {confirmedOrder.result.tracking_pin && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="text-slate-600">
                    Guarda tus datos para rastrear la verificación en vivo:
                  </span>
                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                    Orden: {confirmedOrder.result.order_number} · PIN: {confirmedOrder.result.tracking_pin}
                  </span>
                </div>
              )}

              <div className="border-t border-b border-slate-100 py-4 space-y-2 text-sm">
                {confirmedOrder.lines.map((l, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 tabular-nums">
                    <span className="text-slate-700 truncate">
                      {l.qty} × {l.name}
                      {l.variantLabel ? ` · ${l.variantLabel}` : ''}
                    </span>
                    <span className="font-medium text-slate-900 shrink-0">{money(l.subtotal)}</span>
                  </div>
                ))}
                {confirmedOrder.result.tax_amount > 0 && (
                  <div className="flex justify-between text-xs text-slate-500 pt-2 border-t border-slate-100 tabular-nums">
                    <span>Impuestos</span>
                    <span>{money(confirmedOrder.result.tax_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 pt-2 tabular-nums">
                  <span>Total de la compra</span>
                  <span>{money(confirmedOrder.result.total)}</span>
                </div>
                <div className="flex justify-between text-xs text-slate-500 tabular-nums">
                  <span>Medio reportado</span>
                  <span>
                    {confirmedOrder.paymentLabel}
                    {confirmedOrder.paymentReference ? ` · Ref. #${confirmedOrder.paymentReference}` : ''}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {cleanPhoneDigits(
                  waSettings.business_whatsapp || confirmedOrder.result.company_phone || company.phone
                ) && (
                  <a
                    href={
                      `https://wa.me/${cleanPhoneDigits(
                        waSettings.business_whatsapp ||
                          confirmedOrder.result.company_phone ||
                          company.phone
                      )}?text=` +
                      encodeURIComponent(
                        [
                          `Hola *${confirmedOrder.result.company_name}*, acabo de registrar mi compra *${confirmedOrder.result.order_number}* desde su tienda en línea.`,
                          `Comprador: ${confirmedOrder.customerName} (${confirmedOrder.customerType === 'juridica' ? 'Persona Jurídica' : 'Persona Natural'})`,
                          confirmedOrder.documentId ? `Documento / RIF: ${confirmedOrder.documentId}` : '',
                          `Pago: ${confirmedOrder.paymentLabel}${confirmedOrder.paymentReference ? ` (Ref. #${confirmedOrder.paymentReference})` : ''}`,
                          confirmedOrder.hasProof ? 'Capture de pago: Adjunto en el sistema' : '',
                          '',
                          ...confirmedOrder.lines.map(
                            l =>
                              `• ${l.qty} x ${l.name}${l.variantLabel ? ` [${l.variantLabel}]` : ''} (${money(l.subtotal)})`
                          ),
                          '',
                          `*Total: ${money(confirmedOrder.result.total)}*`,
                          canonicalStoreUrl,
                        ]
                          .filter(Boolean)
                          .join('\n')
                      )
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap ${brand.primaryBtn}`}
                  >
                    <MessageCircle className="w-4 h-4" />
                    Notificar por WhatsApp
                  </a>
                )}

                <button
                  type="button"
                  onClick={handlePrintVoucher}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <Printer className="w-4 h-4" />
                  Comprobante PDF
                </button>

                <button
                  type="button"
                  onClick={() => setActiveView('track')}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <PackageSearch className="w-4 h-4" />
                  Rastrear estado
                </button>

                <button
                  type="button"
                  onClick={() => setConfirmedOrder(null)}
                  className="px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                >
                  Nueva compra
                </button>
              </div>
            </div>
          </div>
        </main>
      ) : (
        /* Tienda Principal del Catálogo */
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
          {/* Sección 1: Hero corporativo + Buscador, Categorías y Moneda */}
          <section className="space-y-4">
            <div className={`rounded-2xl p-6 sm:p-8 ${brand.heroBanner}`}>
              <div className="max-w-2xl space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight [text-wrap:balance]">
                  {company.welcome || `Tienda y catálogo oficial de ${company.name}`}
                </h1>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-85">
                  <span>Personas Naturales y Jurídicas</span>
                  {company.rif && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{company.rif}</span>
                    </>
                  )}
                  {company.show_wholesale && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Precios al detal y mayor automático</span>
                    </>
                  )}
                  {company.address && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{company.address}</span>
                    </>
                  )}
                  {waSettings.business_hours && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{waSettings.business_hours}</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Barra de herramientas de exploración */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex flex-col sm:flex-row gap-2.5 flex-1">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar producto, talla, presentación o SKU..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:border-slate-700"
                  />
                </div>

                {/* Acceso rápido móvil a rastreo de pedido */}
                <button
                  type="button"
                  onClick={() => setActiveView('track')}
                  className="md:hidden inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-700 whitespace-nowrap"
                >
                  <PackageSearch className="w-3.5 h-3.5" />
                  Rastrear mi pedido
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {availableFxCodes.length > 0 && (
                  <div className="inline-flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setDisplayFxCode('BASE')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        displayFxCode === 'BASE'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {baseCur}
                    </button>
                    {availableFxCodes.map(code => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setDisplayFxCode(code)}
                        className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          displayFxCode === code
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {code}
                      </button>
                    ))}
                  </div>
                )}

                {categories.length > 0 && (
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto max-w-full">
                    <button
                      type="button"
                      onClick={() => setSelectedCategory('all')}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        selectedCategory === 'all'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Todos ({products.length})
                    </button>
                    {categories.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCategory(c.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          selectedCategory === c.id
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Sección 2: Colección de Productos con Selector de Cualidades / Presentaciones */}
          {filteredProducts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center space-y-2">
              <p className="text-sm font-medium text-slate-800">
                No se encontraron productos para esta búsqueda
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('')
                  setSelectedCategory('all')
                }}
                className="text-xs font-semibold text-slate-700 underline underline-offset-2"
              >
                Mostrar todo el catálogo
              </button>
            </div>
          ) : (
            <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProducts.map(p => {
                const activeVar = getActiveVariant(p)
                const lineKey = cartKeyOf(p.id, activeVar?.id)
                const qtyInCart = cart[lineKey] || 0
                const maxForVar = getMaxQtyForVariant(p, activeVar)
                const reservedOther = getReservedBaseByOtherVariants(p, activeVar?.id, cart)
                const knownStockLimit =
                  typeof p.exact_stock === 'number' || Boolean(company.show_stock)
                const outOfStock = !p.in_stock || (knownStockLimit && maxForVar <= 0)
                const pendingQty = Math.max(1, round2(pendingQtyByProd[p.id] || 1))
                const pendingInputValue =
                  p.id in pendingDraftByProd ? pendingDraftByProd[p.id] : String(pendingQty)
                const cartInputValue =
                  lineKey in cartQtyDraftByKey ? cartQtyDraftByKey[lineKey] : String(qtyInCart)
                const isVerifyingProd = Boolean(verifyingByProd[p.id])
                const hasCardStockAlert = stockAlert?.productId === p.id
                const wasJustAdded = justAddedKey === lineKey

                const otherVarsSummary = (p.variants || [])
                  .filter(v => v.id !== activeVar?.id && (cart[cartKeyOf(p.id, v.id)] || 0) > 0)
                  .map(v => `${v.label} ×${cart[cartKeyOf(p.id, v.id)]}`)
                  .join(' · ')

                const effectivePrice = activeVar ? Number(activeVar.price) : Number(p.price)
                const effectiveWholesale = activeVar
                  ? Number(activeVar.price_wholesale || 0)
                  : Number(p.price_wholesale || 0)

                const formattedMain = formatDisplayPrice(effectivePrice)
                const formattedWh =
                  effectiveWholesale > 0 ? formatDisplayPrice(effectiveWholesale) : null

                return (
                  <article
                    key={p.id}
                    className={`bg-white rounded-xl border overflow-hidden flex flex-col transition-transform duration-150 hover:-translate-y-0.5 ${
                      hasCardStockAlert
                        ? 'border-amber-300 ring-1 ring-amber-200'
                        : 'border-slate-200'
                    }`}
                  >
                    <div className="relative bg-white border-b border-slate-100">
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(p)}
                        className="w-full block text-left focus:outline-none"
                      >
                        <ProductThumb
                          src={p.image_url}
                          name={p.name}
                          size="card"
                          fit="contain"
                          className="border-0 rounded-none"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(p)}
                        title="Ampliar fotografía"
                        className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-white/95 text-slate-700 hover:bg-slate-900 hover:text-white border border-slate-200/80 shadow-sm transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {p.featured && (
                        <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-slate-900/90 text-white text-[11px] font-medium">
                          Destacado
                        </span>
                      )}
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                      <div className="space-y-2">
                        {/* Metadatos limpios sin cápsulas */}
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span className="truncate">{p.category_name || 'General'}</span>
                          <span className="tabular-nums shrink-0">
                            {!p.in_stock
                              ? 'Agotado'
                              : outOfStock && reservedOther > 0
                                ? 'En tu carrito'
                                : outOfStock
                                  ? 'Agotado'
                                  : company.show_stock
                                    ? `${maxForVar} disp.`
                                    : 'Disponible'}
                          </span>
                        </div>

                        <h2 className="text-base font-semibold text-slate-900 leading-snug">
                          {p.name}
                        </h2>

                        {p.description && (
                          <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                            {p.description}
                          </p>
                        )}

                        {/* Selector interactivo de Variantes / Tallas / Medidas */}
                        {p.variants && p.variants.length > 0 && (
                          <div className="pt-1 space-y-1.5">
                            <span className="block text-[11px] font-medium text-slate-500">
                              {p.variant_group_label || 'Talla / Medida'}:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {p.variants
                                .filter(v => v.available !== false)
                                .map(v => {
                                  const isSelected = activeVar?.id === v.id
                                  const vCount = cart[cartKeyOf(p.id, v.id)] || 0
                                  return (
                                    <button
                                      key={v.id}
                                      type="button"
                                      onClick={() =>
                                        setSelectedVariantByProd(prev => ({
                                          ...prev,
                                          [p.id]: v.id,
                                        }))
                                      }
                                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                                        isSelected
                                          ? `${brand.activeSegment} border-transparent`
                                          : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                                      }`}
                                    >
                                      {v.label}
                                      {vCount > 0 ? ` (${vCount})` : ''}
                                    </button>
                                  )
                                })}
                            </div>
                          </div>
                        )}

                        <div className="pt-1 flex items-baseline justify-between gap-2">
                          <div>
                            <p className="text-base font-bold text-slate-900 tabular-nums">
                              {formattedMain.main}{' '}
                              <span className="text-xs font-normal text-slate-500">
                                / {activeVar ? activeVar.label : p.unit}
                              </span>
                            </p>
                            {formattedMain.sub && (
                              <p className="text-[11px] text-slate-400 tabular-nums">
                                Ref: {formattedMain.sub}
                              </p>
                            )}
                          </div>
                          {company.show_wholesale &&
                            formattedWh &&
                            Number(p.wholesale_min_qty) > 0 && (
                              <p className={`text-xs font-semibold tabular-nums text-right ${brand.accentText}`}>
                                Mayor {formattedWh.main} (≥{p.wholesale_min_qty})
                              </p>
                            )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {hasCardStockAlert && stockAlert && !drawerOpen && (
                          <div
                            role="status"
                            aria-live="polite"
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 space-y-1.5"
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <span className="leading-snug">{stockAlert.message}</span>
                              <button
                                type="button"
                                onClick={dismissStockAlert}
                                className="text-amber-700 hover:text-amber-950 p-0.5 shrink-0"
                                aria-label="Cerrar aviso de stock"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                            {stockAlert.canQuickAddAvailable &&
                              stockAlert.availableUnits !== null &&
                              stockAlert.availableUnits > 0 && (
                                <button
                                  type="button"
                                  disabled={isVerifyingProd}
                                  onClick={() =>
                                    void handleQuickAddFromCard(
                                      p,
                                      activeVar,
                                      stockAlert.availableUnits || 1,
                                      { forceClampToAvailable: true }
                                    )
                                  }
                                  className="inline-flex items-center gap-1 font-semibold text-amber-950 underline underline-offset-2 tabular-nums"
                                >
                                  Añadir {stockAlert.availableUnits} disponibles al carrito
                                </button>
                              )}
                          </div>
                        )}

                        {outOfStock && qtyInCart <= 0 ? (
                          <button
                            type="button"
                            disabled
                            className="w-full py-2.5 px-4 rounded-lg bg-slate-100 text-slate-400 text-xs font-medium cursor-not-allowed whitespace-nowrap"
                          >
                            {p.in_stock && reservedOther > 0
                              ? 'Stock disponible ya en tu carrito'
                              : 'Sin existencias en esta presentación'}
                          </button>
                        ) : qtyInCart > 0 ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
                                <button
                                  type="button"
                                  disabled={isVerifyingProd}
                                  onClick={() =>
                                    setLineQtyImmediate(p, activeVar, round2(qtyInCart - 1))
                                  }
                                  className="p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                  aria-label="Restar unidad"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={cartInputValue}
                                  disabled={isVerifyingProd}
                                  onChange={e =>
                                    setCartQtyDraftByKey(prev => ({
                                      ...prev,
                                      [lineKey]: e.target.value,
                                    }))
                                  }
                                  onBlur={e => {
                                    if (!(lineKey in cartQtyDraftByKey)) return
                                    const parsed = parseFloat(e.target.value)
                                    void setLineQty(
                                      p,
                                      activeVar,
                                      Number.isFinite(parsed) ? parsed : qtyInCart
                                    )
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const parsed = parseFloat(
                                        (e.currentTarget as HTMLInputElement).value
                                      )
                                      void setLineQty(
                                        p,
                                        activeVar,
                                        Number.isFinite(parsed) ? parsed : qtyInCart
                                      )
                                    }
                                  }}
                                  aria-label="Cantidad en carrito"
                                  className="w-14 text-center py-1.5 px-1 text-xs font-bold text-slate-900 tabular-nums focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={isVerifyingProd}
                                  onClick={() =>
                                    void setLineQty(p, activeVar, round2(qtyInCart + 1))
                                  }
                                  className="p-2 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                  aria-label="Sumar unidad"
                                >
                                  {isVerifyingProd ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Plus className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>

                              <button
                                type="button"
                                onClick={() => openCartDrawer('cart')}
                                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${brand.secondaryBtn} border`}
                              >
                                {wasJustAdded ? (
                                  <>
                                    <Check className="w-3.5 h-3.5" />
                                    Agregado
                                  </>
                                ) : (
                                  <>
                                    <ShoppingCart className="w-3.5 h-3.5" />
                                    En carrito
                                  </>
                                )}
                              </button>
                            </div>

                            {company.show_wholesale &&
                              effectiveWholesale > 0 &&
                              Number(p.wholesale_min_qty) > 0 &&
                              qtyInCart < Number(p.wholesale_min_qty) && (
                                <button
                                  type="button"
                                  disabled={isVerifyingProd}
                                  onClick={() =>
                                    void setLineQty(p, activeVar, Number(p.wholesale_min_qty))
                                  }
                                  className="w-full text-[11px] font-medium text-slate-600 hover:text-slate-900 underline underline-offset-2 tabular-nums text-left disabled:opacity-50"
                                >
                                  Subir a {p.wholesale_min_qty} para activar precio mayorista
                                </button>
                              )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <div className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 overflow-hidden shrink-0">
                              <button
                                type="button"
                                disabled={isVerifyingProd}
                                onClick={() => {
                                  const next = Math.max(1, round2(pendingQty - 1))
                                  setPendingDraftByProd(prev => {
                                    if (!(p.id in prev)) return prev
                                    const copy = { ...prev }
                                    delete copy[p.id]
                                    return copy
                                  })
                                  setPendingQtyByProd(prev => ({
                                    ...prev,
                                    [p.id]: next,
                                  }))
                                }}
                                className="p-2 text-slate-600 hover:bg-slate-200/70 disabled:opacity-40 transition-colors"
                                aria-label="Disminuir cantidad a agregar"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                step="any"
                                value={pendingInputValue}
                                disabled={isVerifyingProd}
                                onChange={e => {
                                  const rawVal = e.target.value
                                  setPendingDraftByProd(prev => ({ ...prev, [p.id]: rawVal }))
                                  const parsed = parseFloat(rawVal)
                                  if (Number.isFinite(parsed) && parsed > 0) {
                                    setPendingQtyByProd(prev => ({
                                      ...prev,
                                      [p.id]: round2(parsed),
                                    }))
                                  }
                                }}
                                onBlur={e => {
                                  const parsed = parseFloat(e.target.value)
                                  const safe =
                                    Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 1
                                  setPendingQtyByProd(prev => ({ ...prev, [p.id]: safe }))
                                  setPendingDraftByProd(prev => {
                                    if (!(p.id in prev)) return prev
                                    const copy = { ...prev }
                                    delete copy[p.id]
                                    return copy
                                  })
                                }}
                                onKeyDown={e => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault()
                                    const parsed = parseFloat(
                                      (e.currentTarget as HTMLInputElement).value
                                    )
                                    const desired =
                                      Number.isFinite(parsed) && parsed > 0
                                        ? round2(parsed)
                                        : pendingQty
                                    void handleQuickAddFromCard(p, activeVar, desired)
                                  }
                                }}
                                aria-label="Cantidad a agregar"
                                className="w-11 bg-transparent text-center py-1.5 text-xs font-semibold text-slate-900 tabular-nums focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={isVerifyingProd}
                                onClick={() => {
                                  const next = round2(pendingQty + 1)
                                  setPendingDraftByProd(prev => {
                                    if (!(p.id in prev)) return prev
                                    const copy = { ...prev }
                                    delete copy[p.id]
                                    return copy
                                  })
                                  setPendingQtyByProd(prev => ({
                                    ...prev,
                                    [p.id]: next,
                                  }))
                                }}
                                className="p-2 text-slate-600 hover:bg-slate-200/70 disabled:opacity-40 transition-colors"
                                aria-label="Aumentar cantidad a agregar"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <button
                              type="button"
                              disabled={isVerifyingProd}
                              onClick={() => {
                                const draftRaw = pendingDraftByProd[p.id]
                                const parsedDraft =
                                  draftRaw !== undefined ? parseFloat(draftRaw) : NaN
                                const effectiveDesired =
                                  Number.isFinite(parsedDraft) && parsedDraft > 0
                                    ? round2(parsedDraft)
                                    : pendingQty
                                void handleQuickAddFromCard(p, activeVar, effectiveDesired)
                              }}
                              className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${brand.primaryBtn}`}
                            >
                              {isVerifyingProd ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  Verificando...
                                </>
                              ) : (
                                <>
                                  <ShoppingCart className="w-3.5 h-3.5" />
                                  Agregar
                                </>
                              )}
                            </button>
                          </div>
                        )}

                        {otherVarsSummary && (
                          <button
                            type="button"
                            onClick={() => openCartDrawer('cart')}
                            className="w-full text-left text-[11px] text-slate-500 hover:text-slate-800 truncate tabular-nums"
                          >
                            Otras medidas en carrito: {otherVarsSummary}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                )
              })}
            </section>
          )}
        </main>
      )}

      {/* Footer limpio */}
      <footer className="border-t border-slate-200 bg-white py-5 px-4 sm:px-6 text-xs text-slate-500">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            {company.name}
            {company.rif ? ` · ${company.rif}` : ''} · Ventas digitales al detal y mayor
          </span>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => void handleShareStoreUrl()}
              className="inline-flex items-center gap-1 hover:text-slate-900 underline underline-offset-2"
            >
              {copiedStoreUrl ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Share2 className="w-3.5 h-3.5" />}
              {copiedStoreUrl ? 'Enlace de tienda copiado' : 'Compartir tienda'}
            </button>
            <button
              type="button"
              onClick={() => setActiveView('track')}
              className="hover:text-slate-900 underline underline-offset-2"
            >
              Rastrear mi pedido
            </button>
            {(waSettings.business_whatsapp || company.phone) && (
              <span className="tabular-nums">
                Atención: {waSettings.business_whatsapp || company.phone}
              </span>
            )}
          </div>
        </div>
      </footer>

      {/* Barra móvil inferior compacta (respeta <= 15% viewport móvil) */}
      {totalItemsCount > 0 && !drawerOpen && !confirmedOrder && activeView === 'store' && (
        <div className="fixed bottom-3 inset-x-4 z-30 sm:hidden">
          <button
            type="button"
            onClick={() => openCartDrawer('cart')}
            className={`w-full py-3 px-4 rounded-xl shadow-lg flex items-center justify-between text-sm font-semibold tabular-nums ${brand.primaryBtn}`}
          >
            <span className="inline-flex items-center gap-2 whitespace-nowrap">
              <ShoppingCart className="w-4 h-4" />
              Ver carrito ({totalItemsCount})
            </span>
            <span className="whitespace-nowrap">{formatDisplayPrice(totals.total).main}</span>
          </button>
        </div>
      )}

      {/* Aviso flotante de verificación de stock en tiempo real */}
      {stockAlert && (
        <div
          role="alert"
          aria-live="assertive"
          className="fixed top-20 inset-x-4 sm:left-auto sm:right-6 sm:w-full sm:max-w-md z-[60] rounded-xl border border-amber-300 bg-amber-50 shadow-xl p-3.5 text-xs text-amber-950"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-bold text-amber-950 leading-snug">{stockAlert.title}</p>
              <p className="text-amber-900 leading-relaxed">{stockAlert.message}</p>
              {stockAlert.canQuickAddAvailable &&
                stockAlert.availableUnits !== null &&
                stockAlert.availableUnits > 0 && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const targetProd = products.find(x => x.id === stockAlert.productId)
                        if (!targetProd) return
                        const targetVar = stockAlert.variantId
                          ? (targetProd.variants || []).find(
                              v => v.id === stockAlert.variantId && v.available !== false
                            ) || null
                          : null
                        void handleQuickAddFromCard(
                          targetProd,
                          targetVar,
                          stockAlert.availableUnits || 1,
                          { forceClampToAvailable: true }
                        )
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-900 text-white text-[11px] font-semibold hover:bg-amber-950 transition-colors tabular-nums whitespace-nowrap"
                    >
                      <ShoppingCart className="w-3 h-3" />
                      Agregar {stockAlert.availableUnits}{' '}
                      {stockAlert.availableUnits === 1 ? 'disponible' : 'disponibles'}
                    </button>
                  </div>
                )}
            </div>
            <button
              type="button"
              onClick={dismissStockAlert}
              className="p-1 rounded-md text-amber-700 hover:bg-amber-200/60 hover:text-amber-950 shrink-0"
              aria-label="Cerrar aviso de disponibilidad"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Drawer Persistente en 2 Pasos: Paso 1 Carrito de Compras -> Paso 2 Datos y Comprobante */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex justify-end"
          onClick={() => !submitting && setDrawerOpen(false)}
        >
          <div
            className="bg-white w-full max-w-xl h-full flex flex-col overflow-hidden shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Cabecera del panel */}
            <div className="px-5 py-4 border-b border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-900 truncate">
                    {cartLines.length === 0 || cartStep === 'cart'
                      ? 'Carrito de compras'
                      : 'Finalizar pedido y comprobante'}
                  </h2>
                  <p className="text-xs text-slate-500 truncate">
                    {company.name} · Tu selección queda guardada automáticamente
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => !submitting && setDrawerOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
                  aria-label="Cerrar carrito"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {cartLines.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setCartStep('cart')}
                    className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                      cartStep === 'cart'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    1. Carrito ({totalItemsCount})
                  </button>
                  <button
                    type="button"
                    disabled={verifyingCheckoutStock}
                    onClick={() => void handleProceedToCheckout()}
                    className={`py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
                      cartStep === 'checkout'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {verifyingCheckoutStock ? 'Verificando stock...' : '2. Comprobante de pago'}
                  </button>
                </div>
              )}
            </div>

            {cartLines.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <ShoppingBag className="w-9 h-9 text-slate-300" />
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-slate-800">
                    Tu carrito de compras está vacío
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                    Elige productos, ajusta cantidades y selecciona tallas o medidas en el catálogo antes de adjuntar tu comprobante de pago.
                  </p>
                </div>
                {cartReconcileNotices.length > 0 && (
                  <div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-900 space-y-1">
                    {cartReconcileNotices.map((msg, i) => (
                      <p key={i}>{msg}</p>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className={`mt-1 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${brand.primaryBtn}`}
                >
                  Explorar productos
                </button>
              </div>
            ) : cartStep === 'cart' ? (
              /* PASO 1: Carrito de Compras (Ajuste de productos, cantidades y variantes/tallas/medidas) */
              <div className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {stockAlert && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                        <div className="space-y-0.5">
                          <strong className="block font-semibold">{stockAlert.title}</strong>
                          <p className="text-amber-900 leading-relaxed">{stockAlert.message}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={dismissStockAlert}
                        className="text-amber-700 hover:text-amber-950 p-0.5 shrink-0"
                        aria-label="Cerrar aviso"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  {cartReconcileNotices.length > 0 && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <strong className="block font-semibold">
                          Actualizamos tu carrito guardado:
                        </strong>
                        {cartReconcileNotices.map((msg, idx) => (
                          <p key={idx}>{msg}</p>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setCartReconcileNotices([])}
                        className="text-amber-700 hover:text-amber-950 p-0.5 shrink-0"
                        aria-label="Cerrar aviso"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-700 tabular-nums">
                      {cartLines.length}{' '}
                      {cartLines.length === 1 ? 'presentación seleccionada' : 'presentaciones seleccionadas'}
                    </span>

                    {confirmClearCart ? (
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">¿Vaciar todo?</span>
                        <button
                          type="button"
                          onClick={handleClearCart}
                          className="font-semibold text-red-600 hover:text-red-700 whitespace-nowrap shrink-0"
                        >
                          Sí, vaciar
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmClearCart(false)}
                          className="font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmClearCart(true)}
                        className="text-slate-500 hover:text-red-600 font-medium whitespace-nowrap shrink-0"
                      >
                        Vaciar carrito
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {cartLines.map(l => {
                      const availVariants = (l.product.variants || []).filter(
                        v => v.available !== false
                      )
                      const maxLineQty = getMaxQtyForVariant(l.product, l.variant)
                      const canAddExtraVariant = availVariants.some(v => {
                        const k = cartKeyOf(l.product.id, v.id)
                        return !(cart[k] > 0)
                      })
                      const isLineVerifying = Boolean(verifyingByProd[l.product.id])
                      const isLineStockAlert = stockAlert?.productId === l.product.id
                      const lineInputValue =
                        l.key in cartQtyDraftByKey ? cartQtyDraftByKey[l.key] : String(l.qty)
                      const lineDisplayTotal = formatDisplayPrice(l.subtotal)
                      const lineDisplayUnit = formatDisplayPrice(l.unitPrice)

                      return (
                        <div
                          key={l.key}
                          className={`rounded-xl border bg-white p-3.5 space-y-3 ${
                            isLineStockAlert
                              ? 'border-amber-300 ring-1 ring-amber-200'
                              : 'border-slate-200'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <ProductThumb
                              src={l.product.image_url}
                              name={l.product.name}
                              size="md"
                              fit="contain"
                              className="shrink-0"
                            />

                            <div className="min-w-0 flex-1 space-y-0.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-semibold text-slate-900 leading-snug">
                                  {l.product.name}
                                </p>
                                <button
                                  type="button"
                                  disabled={isLineVerifying}
                                  onClick={() => setLineQtyImmediate(l.product, l.variant, 0)}
                                  className="p-1 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0 disabled:opacity-40"
                                  aria-label="Quitar del carrito"
                                  title="Quitar del carrito"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              <p className="text-xs text-slate-500 tabular-nums">
                                {l.product.sku ? `SKU ${l.product.sku} · ` : ''}
                                {lineDisplayUnit.main} / {l.variant ? l.variant.label : l.product.unit}
                                {l.isWholesale ? ' · Tarifa mayorista activa' : ''}
                              </p>
                            </div>
                          </div>

                          {/* Cambio directo de talla / medida / presentación dentro del carrito */}
                          {availVariants.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                <label className="text-[11px] font-medium text-slate-500 whitespace-nowrap shrink-0">
                                  {l.product.variant_group_label || 'Talla / Medida'}:
                                </label>
                                <select
                                  value={l.variant?.id || availVariants[0].id}
                                  disabled={isLineVerifying}
                                  onChange={e =>
                                    void changeLineVariant(l.product, l.variant, e.target.value)
                                  }
                                  aria-label={`Cambiar variante de ${l.product.name}`}
                                  className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-300 bg-slate-50 text-xs font-medium text-slate-900 focus:outline-none focus:border-slate-700 disabled:opacity-50"
                                >
                                  {availVariants.map(v => (
                                    <option key={v.id} value={v.id}>
                                      {v.label} — {formatDisplayPrice(v.price).main}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {canAddExtraVariant && (
                                <button
                                  type="button"
                                  disabled={isLineVerifying}
                                  onClick={() => void addAnotherVariantToCart(l.product)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:text-slate-950 underline underline-offset-2 whitespace-nowrap shrink-0 disabled:opacity-50"
                                >
                                  <Plus className="w-3 h-3" />
                                  Otra talla / medida
                                </button>
                              )}
                            </div>
                          )}

                          {/* Controles de cantidad y subtotal por línea */}
                          <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100">
                            <div className="flex items-center gap-2">
                              <div className="inline-flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden">
                                <button
                                  type="button"
                                  disabled={isLineVerifying}
                                  onClick={() =>
                                    setLineQtyImmediate(l.product, l.variant, round2(l.qty - 1))
                                  }
                                  className="p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                  aria-label="Disminuir cantidad"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={0}
                                  step="any"
                                  value={lineInputValue}
                                  disabled={isLineVerifying}
                                  onChange={e =>
                                    setCartQtyDraftByKey(prev => ({
                                      ...prev,
                                      [l.key]: e.target.value,
                                    }))
                                  }
                                  onBlur={e => {
                                    if (!(l.key in cartQtyDraftByKey)) return
                                    const parsed = parseFloat(e.target.value)
                                    void setLineQty(
                                      l.product,
                                      l.variant,
                                      Number.isFinite(parsed) ? parsed : l.qty
                                    )
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault()
                                      const parsed = parseFloat(
                                        (e.currentTarget as HTMLInputElement).value
                                      )
                                      void setLineQty(
                                        l.product,
                                        l.variant,
                                        Number.isFinite(parsed) ? parsed : l.qty
                                      )
                                    }
                                  }}
                                  aria-label={`Cantidad de ${l.product.name}`}
                                  className="w-14 text-center py-1 px-1 text-xs font-bold text-slate-900 tabular-nums focus:outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={isLineVerifying}
                                  onClick={() =>
                                    void setLineQty(l.product, l.variant, round2(l.qty + 1))
                                  }
                                  className="p-1.5 text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-colors"
                                  aria-label="Aumentar cantidad"
                                >
                                  {isLineVerifying ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  ) : (
                                    <Plus className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              </div>

                              {(company.show_stock || typeof l.product.exact_stock === 'number') &&
                                maxLineQty < 9999 && (
                                  <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                                    Disp. {maxLineQty}
                                  </span>
                                )}
                            </div>

                            <div className="text-right tabular-nums shrink-0">
                              <p className="text-sm font-bold text-slate-900">
                                {lineDisplayTotal.main}
                              </p>
                              {lineDisplayTotal.sub && (
                                <p className="text-[11px] text-slate-400">{lineDisplayTotal.sub}</p>
                              )}
                            </div>
                          </div>

                          {company.show_wholesale &&
                            !l.isWholesale &&
                            l.wholesalePriceCandidate > 0 &&
                            Number(l.product.wholesale_min_qty) > 0 &&
                            l.qty < Number(l.product.wholesale_min_qty) && (
                              <button
                                type="button"
                                disabled={isLineVerifying}
                                onClick={() =>
                                  void setLineQty(
                                    l.product,
                                    l.variant,
                                    Number(l.product.wholesale_min_qty)
                                  )
                                }
                                className={`w-full text-left text-[11px] font-semibold underline underline-offset-2 tabular-nums disabled:opacity-50 ${brand.accentText}`}
                              >
                                Sube a {l.product.wholesale_min_qty} und. para activar mayorista ({formatDisplayPrice(l.wholesalePriceCandidate).main} c/u)
                              </button>
                            )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Pie fijo del Paso 1: Resumen económico + Paso al Comprobante de Pago */}
                <div className="border-t border-slate-200 bg-slate-50 p-5 space-y-3.5">
                  <div className="space-y-1 text-xs tabular-nums">
                    {wholesaleSavings > 0 && (
                      <div className="flex justify-between text-emerald-700 font-medium">
                        <span>Ahorro por tarifa mayorista</span>
                        <span>-{money(wholesaleSavings)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Subtotal ({totalItemsCount} und.)</span>
                      <span>{money(totals.subtotal)}</span>
                    </div>
                    {totals.tax > 0 && (
                      <div className="flex justify-between text-slate-600">
                        <span>Impuesto ({totals.rate}%)</span>
                        <span>{money(totals.tax)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                      <span>Total del pedido</span>
                      <span>{money(totals.total)}</span>
                    </div>
                    {fxEquivalentTotal && (
                      <div className="flex justify-between text-xs font-semibold text-slate-700">
                        <span>Equivalente ref. ({fxEquivalentTotal.code})</span>
                        <span>{fxEquivalentTotal.formatted}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setDrawerOpen(false)}
                      className="px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                    >
                      Seguir eligiendo
                    </button>
                    <button
                      type="button"
                      disabled={verifyingCheckoutStock}
                      onClick={() => void handleProceedToCheckout()}
                      className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${brand.primaryBtn}`}
                    >
                      {verifyingCheckoutStock ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                          <span>Verificando stock en tiempo real...</span>
                        </>
                      ) : (
                        <>
                          <span>Continuar al pago y comprobante</span>
                          <ArrowRight className="w-4 h-4 shrink-0" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* PASO 2: Datos Fiscales, Entrega y Comprobante de Pago */
              <form onSubmit={handleSubmitOrder} className="flex-1 flex flex-col overflow-hidden">
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                  {/* Resumen compacto del carrito confirmado antes de pagar */}
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3.5 space-y-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 tabular-nums">
                        Resumen de tu carrito ({totalItemsCount} und.)
                      </span>
                      <button
                        type="button"
                        onClick={() => setCartStep('cart')}
                        className="font-semibold text-slate-700 hover:text-slate-950 underline underline-offset-2 whitespace-nowrap shrink-0"
                      >
                        Editar cantidades o tallas
                      </button>
                    </div>

                    <div className="divide-y divide-slate-200/70 max-h-36 overflow-y-auto pr-1">
                      {cartLines.map(l => (
                        <div
                          key={l.key}
                          className="py-1.5 flex items-center justify-between gap-3 tabular-nums"
                        >
                          <span className="text-slate-700 truncate">
                            {l.qty} × {l.product.name}
                            {l.variant ? ` · ${l.variant.label}` : ''}
                          </span>
                          <span className="font-semibold text-slate-900 shrink-0">
                            {money(l.subtotal)}
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-200 flex items-baseline justify-between gap-2 tabular-nums">
                      <span className="font-semibold text-slate-700">Total a cancelar</span>
                      <div className="text-right">
                        <span className="text-sm font-bold text-slate-900">
                          {money(totals.total)}
                        </span>
                        {fxEquivalentTotal && (
                          <span className="block text-[11px] font-semibold text-slate-600">
                            Ref. {fxEquivalentTotal.formatted}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 1. Identificación: Persona Natural o Persona Jurídica */}
                  <div className="space-y-3">
                    <span className="block text-xs font-semibold text-slate-800">
                      1. Tipo de comprador y datos fiscales
                    </span>

                    <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setCustomerType('natural')}
                        className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                          customerType === 'natural'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        Persona Natural
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomerType('juridica')}
                        className={`inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                          customerType === 'juridica'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Building2 className="w-3.5 h-3.5" />
                        Persona Jurídica
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-slate-600 mb-1">
                          {customerType === 'juridica'
                            ? 'Razón social de la empresa *'
                            : 'Nombre y apellido *'}
                        </label>
                        <input
                          required
                          value={customerName}
                          onChange={e => setCustomerName(e.target.value)}
                          placeholder={
                            customerType === 'juridica'
                              ? 'Ej. Inversiones El Roble C.A.'
                              : 'Ej. María Fernanda Gómez'
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          {customerType === 'juridica'
                            ? 'RIF / NIT / RUT *'
                            : 'Cédula / Documento'}
                        </label>
                        <input
                          required={customerType === 'juridica'}
                          value={documentId}
                          onChange={e => setDocumentId(e.target.value)}
                          placeholder={customerType === 'juridica' ? 'J-40123456-7' : 'V-18234567'}
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Teléfono / WhatsApp *
                        </label>
                        <input
                          required
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          placeholder="+58 412 0000000"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                        />
                      </div>

                      {customerType === 'juridica' && (
                        <div>
                          <label className="block text-xs text-slate-600 mb-1">
                            Persona contacto de compras
                          </label>
                          <input
                            value={contactPerson}
                            onChange={e => setContactPerson(e.target.value)}
                            placeholder="Nombre del encargado"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                          />
                        </div>
                      )}

                      <div className={customerType === 'juridica' ? '' : 'sm:col-span-2'}>
                        <label className="block text-xs text-slate-600 mb-1">
                          Correo electrónico (opcional)
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                          placeholder="compras@empresa.com"
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>
                    </div>

                    {customerType === 'juridica' && (
                      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={requiresInvoice}
                          onChange={e => setRequiresInvoice(e.target.checked)}
                          className="accent-slate-900"
                        />
                        Solicitar emisión de factura fiscal a nombre de la razón social
                      </label>
                    )}
                  </div>

                  {/* 2. Modalidad de recepción */}
                  <div className="space-y-2.5">
                    <span className="block text-xs font-semibold text-slate-800">
                      2. Modalidad de entrega
                    </span>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {activeDeliveryModes.map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setDeliveryMode(mode)}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors ${
                            deliveryMode === mode
                              ? `${brand.activeSegment} border-transparent`
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <Truck className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{DELIVERY_MODE_LABELS[mode]}</span>
                        </button>
                      ))}
                    </div>

                    {deliveryMode === 'pickup' ? (
                      company.address && (
                        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                          Dirección de retiro: <strong className="text-slate-700">{company.address}</strong>
                        </p>
                      )
                    ) : (
                      <div>
                        <label className="block text-xs text-slate-600 mb-1">
                          Dirección exacta de entrega / recepción *
                        </label>
                        <input
                          required
                          value={address}
                          onChange={e => setAddress(e.target.value)}
                          placeholder="Ciudad, avenida, local o agencia de encomienda..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                        />
                      </div>
                    )}
                  </div>

                  {/* 3. Pago + Capture del Recibo */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-slate-600" />
                      <span className="text-xs font-semibold text-slate-800">
                        3. Método de pago y comprobante
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {activePaymentMethods.map(pm => {
                        const active = currentPaymentConfig?.id === pm.id
                        return (
                          <button
                            key={pm.id}
                            type="button"
                            onClick={() => setSelectedPaymentId(pm.id)}
                            className={`px-3 py-2 rounded-lg border text-left text-xs font-semibold transition-colors ${
                              active
                                ? `${brand.activeSegment} border-transparent`
                                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <span className="block truncate">{pm.label}</span>
                          </button>
                        )
                      })}
                    </div>

                    {currentPaymentConfig && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <strong className="text-slate-900">
                            Datos para {currentPaymentConfig.label}
                          </strong>
                          {currentPaymentConfig.account_or_phone && (
                            <button
                              type="button"
                              onClick={() => void handleCopyPaymentDetails()}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                            >
                              {copiedPayData ? (
                                <Check className="w-3 h-3 text-emerald-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                              {copiedPayData ? 'Datos copiados' : 'Copiar datos'}
                            </button>
                          )}
                        </div>

                        <div className="space-y-1 text-slate-700 tabular-nums">
                          {currentPaymentConfig.bank_or_platform && (
                            <div>
                              <span className="text-slate-500">Banco / Plataforma: </span>
                              <strong>{currentPaymentConfig.bank_or_platform}</strong>
                            </div>
                          )}
                          {currentPaymentConfig.account_or_phone && (
                            <div>
                              <span className="text-slate-500">Cuenta / Teléfono: </span>
                              <strong className="font-mono">{currentPaymentConfig.account_or_phone}</strong>
                            </div>
                          )}
                          {currentPaymentConfig.holder_name && (
                            <div>
                              <span className="text-slate-500">Beneficiario: </span>
                              <strong>{currentPaymentConfig.holder_name}</strong>
                              {currentPaymentConfig.holder_document
                                ? ` (${currentPaymentConfig.holder_document})`
                                : ''}
                            </div>
                          )}
                          <div className="pt-1 text-slate-900">
                            <span className="text-slate-500">Monto a transferir: </span>
                            <strong>{money(totals.total)}</strong>
                            {fxEquivalentTotal ? ` · ${fxEquivalentTotal.formatted}` : ''}
                          </div>
                        </div>

                        {currentPaymentConfig.instructions && (
                          <p className="text-[11px] text-slate-500 border-t border-slate-200 pt-2">
                            {currentPaymentConfig.instructions}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Subida del Capture / Pantallazo de Pago */}
                    {currentPaymentConfig?.requires_proof && (
                      <div className="rounded-xl border border-slate-300 bg-white p-3.5 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                            <FileCheck2 className="w-4 h-4 text-emerald-700" />
                            Comprobante / Capture de pago *
                          </span>
                          {paymentProofUrl && (
                            <button
                              type="button"
                              onClick={() => setPaymentProofUrl(null)}
                              className="text-[11px] text-red-600 hover:underline whitespace-nowrap shrink-0"
                            >
                              Cambiar capture
                            </button>
                          )}
                        </div>

                        <input
                          ref={proofInputRef}
                          type="file"
                          accept="image/*"
                          onChange={e => void handleProofFileChange(e)}
                          className="hidden"
                        />

                        {paymentProofUrl ? (
                          <div className="flex items-center gap-3 p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200">
                            {paymentProofUrl.startsWith('data:image/') ? (
                              <img
                                src={paymentProofUrl}
                                alt="Capture de pago adjunto"
                                referrerPolicy="no-referrer"
                                className="w-16 h-16 rounded-lg object-cover border border-emerald-300 bg-white shrink-0"
                              />
                            ) : (
                              <div className="w-16 h-16 rounded-lg border border-emerald-300 bg-white flex items-center justify-center shrink-0">
                                <FileCheck2 className="w-7 h-7 text-emerald-700" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1 text-xs">
                              <p className="font-semibold text-emerald-900 flex items-center gap-1">
                                <ClipboardCheck className="w-3.5 h-3.5 shrink-0" />
                                Comprobante cargado correctamente
                              </p>
                              <p className="text-emerald-700 mt-0.5">
                                El comprobante está adjunto y listo para enviar junto con tu pedido.
                              </p>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={uploadingProof}
                            onClick={() => proofInputRef.current?.click()}
                            className="w-full py-4 px-4 rounded-xl border border-dashed border-slate-300 hover:border-slate-500 bg-slate-50/70 hover:bg-slate-100/70 transition-colors flex flex-col items-center justify-center gap-1.5 text-center"
                          >
                            <ImagePlus className="w-5 h-5 text-slate-600" />
                            <span className="text-xs font-semibold text-slate-800">
                              {uploadingProof
                                ? 'Optimizando comprobante...'
                                : 'Subir capture de Pago Móvil, Nequi o transferencia'}
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Toca para elegir el pantallazo desde tu galería o cámara
                            </span>
                          </button>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              N° de referencia / comprobante *
                            </label>
                            <input
                              required={Boolean(currentPaymentConfig?.requires_proof)}
                              value={paymentReference}
                              onChange={e => setPaymentReference(e.target.value)}
                              placeholder="Ej. 84920144"
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Banco o billetera origen
                            </label>
                            <input
                              value={paymentSenderBank}
                              onChange={e => setPaymentSenderBank(e.target.value)}
                              placeholder="Ej. Mercantil / Nequi / Zelle"
                              className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className="block text-xs text-slate-600 mb-1">
                        Observaciones para despacho o facturación
                      </label>
                      <textarea
                        rows={2}
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        placeholder="Horario de recepción, indicaciones de entrega..."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>
                  </div>

                  {submitError && (
                    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5">
                      {submitError}
                    </p>
                  )}
                </div>

                {/* Pie fijo del Paso 2: Volver al carrito o Confirmar Pedido */}
                <div className="border-t border-slate-200 bg-slate-50 p-5 flex items-center gap-2.5">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => setCartStep('cart')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-3 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Carrito
                  </button>
                  <button
                    type="submit"
                    disabled={submitting || uploadingProof}
                    className={`flex-1 py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold disabled:opacity-50 transition-colors tabular-nums whitespace-nowrap ${brand.primaryBtn}`}
                  >
                    {submitting
                      ? 'Registrando pedido y comprobante...'
                      : `Finalizar pedido · ${money(totals.total)}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Visor de fotografía ampliada */}
      <ProductPhotoLightbox
        product={
          previewProduct
            ? {
                id: previewProduct.id,
                name:
                  previewProduct.name +
                  (lightboxVariant ? ` · ${lightboxVariant.label}` : ''),
                sku: previewProduct.sku,
                categoryName: previewProduct.category_name || 'Catálogo',
                description: previewProduct.description,
                unit: lightboxVariant ? lightboxVariant.label : previewProduct.unit,
                priceLabel: lightboxDisplayPrice?.main || money(previewProduct.price),
                wholesaleLabel:
                  company.show_wholesale &&
                  Number(
                    lightboxVariant
                      ? lightboxVariant.price_wholesale
                      : previewProduct.price_wholesale
                  ) > 0 &&
                  Number(previewProduct.wholesale_min_qty) > 0
                    ? `Mayorista: ${money(
                        Number(
                          lightboxVariant
                            ? lightboxVariant.price_wholesale
                            : previewProduct.price_wholesale
                        )
                      )} (desde ${previewProduct.wholesale_min_qty})`
                    : null,
                stockLabel:
                  !previewProduct.in_stock ||
                  (company.show_stock && getMaxQtyForVariant(previewProduct, lightboxVariant) <= 0)
                    ? 'Agotado'
                    : company.show_stock
                      ? `${getMaxQtyForVariant(previewProduct, lightboxVariant)} disp.`
                      : 'Disponible',
                outOfStock:
                  !previewProduct.in_stock ||
                  (company.show_stock && getMaxQtyForVariant(previewProduct, lightboxVariant) <= 0),
                image_url: previewProduct.image_url,
              }
            : null
        }
        onClose={() => setPreviewProduct(null)}
        onAddToSale={
          previewProduct &&
          previewProduct.in_stock &&
          (!(company.show_stock || typeof previewProduct.exact_stock === 'number') ||
            getMaxQtyForVariant(previewProduct, lightboxVariant) > 0)
            ? () => {
                const v = getActiveVariant(previewProduct)
                const currentQty = cart[cartKeyOf(previewProduct.id, v?.id)] || 0
                void setLineQty(previewProduct, v, round2(currentQty + 1))
              }
            : undefined
        }
        addLabel="Agregar al carrito"
      />
    </div>
  )
}
