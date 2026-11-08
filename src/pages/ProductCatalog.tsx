import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  useAuth,
  isReadOnly,
  canManageInventory,
  canManageSettings,
  canRegisterSales,
} from '../lib/auth'
import { useCurrency, formatMoney, CURRENCIES } from '../lib/currency'
import {
  esc,
  printHtml,
  buildDocHtml,
  buildShareText,
  type DocData,
} from '../lib/documents'
import { copyToClipboard } from '../lib/copilotShare'
import { qrSvg } from '../lib/barcode'
import { priceFor, type PriceType } from '../lib/pricing'
import {
  calcTax,
  round2,
  taxModeOf,
  taxRateOf,
  taxDocFields,
} from '../lib/tax'
import {
  ProductThumb,
  ProductPhotoLightbox,
  type LightboxProductInfo,
} from '../components/ProductImageCapture'
import {
  resolvePrintImageUrl,
  getProductMonogram,
  setCatalogPosHandoff,
  hydrateProductsWithImages,
  saveProductImageInSupabase,
} from '../lib/productImages'
import SqlActivationModal from '../components/SqlActivationModal'
import CatalogBrandModal, { type CatalogBrandModalTab } from '../components/CatalogBrandModal'
import {
  normalizeProductVariants,
  resolveBrandTheme,
} from '../lib/catalogCommerce'
import {
  WHATSAPP_SCENARIOS,
  buildCompanyStoreUrl,
  buildPlatformInviteUrl,
  buildPlatformInviteWhatsAppMessage,
  buildStorePreviewCardSummary,
  renderCompanyWhatsAppMessage,
} from '../lib/whatsappStudio'
import type {
  Product,
  Category,
  Customer,
  CompanyConfig,
  WhatsAppTemplateScenario,
} from '../types'
import {
  Search,
  Printer,
  MessageCircle,
  Share2,
  Mail,
  Copy,
  QrCode,
  Eye,
  LayoutGrid,
  List,
  CheckSquare,
  Square,
  ShoppingBag,
  Plus,
  Minus,
  Trash2,
  Store,
  FileText,
  ExternalLink,
  SlidersHorizontal,
  X,
  Check,
  Sparkles,
  Camera,
  Database,
  AlertTriangle,
  Palette,
  ClipboardCheck,
  Globe,
  RefreshCw,
} from 'lucide-react'

type CatalogPriceMode = 'detal' | 'mayor' | 'ambos' | 'oculto'
type CatalogFilterMode = 'disponibles' | 'todos' | 'destacados' | 'seleccionados'
type CurrencyDisplayMode = 'base' | 'fx' | 'dual'

interface DraftOrderItem {
  product_id: string
  quantity: number
}

function cleanPhoneForWhatsApp(raw?: string | null): string {
  const digits = (raw || '').replace(/[^\d]/g, '')
  return digits.length >= 8 ? digits : ''
}

function toDateStr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function ProductCatalog({
  onNavigate,
  onPreviewCatalog,
}: {
  onNavigate?: (page: string) => void
  onPreviewCatalog?: (companyId: string) => void
}) {
  const { user } = useAuth()
  const { fmt: moneyBase, currency: baseCur, fxRates } = useCurrency()
  const readOnly = isReadOnly(user)
  const canSell = canRegisterSales(user?.role) && !readOnly
  const canEditPhotos = (canManageInventory(user?.role) || canRegisterSales(user?.role)) && !readOnly

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [config, setConfig] = useState<CompanyConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [imageSchemaMissing, setImageSchemaMissing] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [brandModalOpen, setBrandModalOpen] = useState(false)
  const [brandModalInitialTab, setBrandModalInitialTab] = useState<CatalogBrandModalTab>('brand')
  const [pendingOrdersCount, setPendingOrdersCount] = useState(0)

  // Filtros y vista del catálogo
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [filterMode, setFilterMode] = useState<CatalogFilterMode>('disponibles')
  const [priceMode, setPriceMode] = useState<CatalogPriceMode>('detal')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [showStockInCatalog, setShowStockInCatalog] = useState(true)
  const [showCustomizeBar, setShowCustomizeBar] = useState(false)

  // Selección personalizada de productos para mini-catálogos a medida
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Configuración multimoneda en vivo
  const savedFxCodes = useMemo(
    () => Object.keys(fxRates).filter(c => c !== baseCur && Number(fxRates[c]) > 0),
    [fxRates, baseCur]
  )
  const defaultFxCode = savedFxCodes[0] || (baseCur === 'USD' ? 'EUR' : 'USD')
  const [currencyMode, setCurrencyMode] = useState<CurrencyDisplayMode>('base')
  const [fxCode, setFxCode] = useState<string>(defaultFxCode)
  const [fxRateInput, setFxRateInput] = useState<string>(() => {
    const r = fxRates[defaultFxCode]
    return r && r > 0 ? String(r) : ''
  })

  // Encabezado comercial personalizable para PDF / WhatsApp
  const [customTitle, setCustomTitle] = useState('Catálogo Comercial de Productos')
  const [customNote, setCustomNote] = useState(
    'Precios sujetos a disponibilidad. Consulta descuentos por volumen con tu asesor comercial.'
  )
  const [advisorPhone, setAdvisorPhone] = useState('')

  // Modales y notificaciones
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const [lightboxProductId, setLightboxProductId] = useState<string | null>(null)
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [showProposalDrawer, setShowProposalDrawer] = useState(false)

  // Estado del modal de WhatsApp
  const [waScenario, setWaScenario] = useState<WhatsAppTemplateScenario>('catalog_selection')
  const [waCustomerId, setWaCustomerId] = useState<string>('')
  const [waCustomPhone, setWaCustomPhone] = useState<string>('')
  const [waCustomText, setWaCustomText] = useState<string>('')
  const [waSearchCustomer, setWaSearchCustomer] = useState<string>('')
  const [urlCacheBuster, setUrlCacheBuster] = useState<string>('')

  // Estado del armador rápido de pedido / cotización
  const [draftItems, setDraftItems] = useState<DraftOrderItem[]>([])
  const [proposalCustomerId, setProposalCustomerId] = useState<string>('')
  const [proposalDiscountPct, setProposalDiscountPct] = useState<string>('')
  const [proposalValidDays, setProposalValidDays] = useState<string>('7')
  const [savingQuotation, setSavingQuotation] = useState(false)

  useEffect(() => {
    void loadCatalogData()
  }, [])

  useEffect(() => {
    const saved = fxRates[fxCode]
    if (saved && saved > 0) {
      setFxRateInput(String(saved))
    }
  }, [fxCode, fxRates])

  useEffect(() => {
    if (!advisorPhone && (user?.phone || config?.phone)) {
      setAdvisorPhone(user?.phone || config?.phone || '')
    }
  }, [user?.phone, config?.phone, advisorPhone])

  function notify(text: string, tone: 'ok' | 'err' = 'ok') {
    setFeedback({ text, tone })
    window.setTimeout(() => {
      setFeedback(prev => (prev?.text === text ? null : prev))
    }, 4200)
  }

  async function loadCatalogData() {
    setLoading(true)
    const [{ data: prods }, { data: cats }, { data: custs }, { data: cfg }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
      supabase.from('customers').select('*').order('name'),
      supabase.from('company_config').select('*').limit(1),
    ])
    const hydrated = await hydrateProductsWithImages((prods || []) as Product[])
    setProducts(hydrated.products)
    setImageSchemaMissing(hydrated.schemaStatus === 'missing_sql')
    setCategories((cats || []) as Category[])
    setCustomers((custs || []) as Customer[])
    setConfig(((cfg || [])[0] as CompanyConfig) ?? null)

    try {
      const { data: ordRows, error: ordErr } = await supabase
        .from('catalog_orders')
        .select('id, payment_status, order_status')
      if (!ordErr && Array.isArray(ordRows)) {
        const pending = ordRows.filter(
          (r: { payment_status?: string; order_status?: string }) =>
            r.payment_status === 'pendiente_verificacion' ||
            (r.order_status === 'nuevo' && r.payment_status !== 'rechazado')
        ).length
        setPendingOrdersCount(pending)
      }
    } catch {
      /* ignore if table not yet created */
    }

    setLoading(false)
  }

  const categoryMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of categories) m.set(c.id, c.name)
    return m
  }, [categories])

  const companyId = user?.company_id || config?.company_id || config?.id || ''
  const companyName = config?.name || user?.company_name || 'Empresa Comercial'
  const advisorName = user?.full_name || 'Asesor Comercial'

  const publicCatalogUrl = useMemo(
    () =>
      buildCompanyStoreUrl(
        window.location.origin,
        companyId,
        config?.catalog_slug,
        config,
        urlCacheBuster || undefined
      ),
    [companyId, config, urlCacheBuster]
  )

  const platformInviteUrl = useMemo(
    () => buildPlatformInviteUrl(window.location.origin),
    []
  )

  const catalogQrMarkup = useMemo(() => {
    try {
      return qrSvg(publicCatalogUrl)
    } catch {
      return ''
    }
  }, [publicCatalogUrl])

  // Conversión multimoneda consistente con FxPayment (1 fxCode = rate baseCur => precioFx = precioBase / rate)
  const fxRateNum = Number(fxRateInput) || 0
  const hasValidFx = currencyMode !== 'base' && fxRateNum > 0

  function convertToFx(amountInBase: number): number {
    if (!(fxRateNum > 0)) return amountInBase
    return round2(amountInBase / fxRateNum)
  }

  function formatCatalogPrice(amountInBase: number): {
    primary: string
    secondary?: string
  } {
    const baseFormatted = moneyBase(amountInBase)
    if (!hasValidFx) {
      return { primary: baseFormatted }
    }
    const fxFormatted = formatMoney(convertToFx(amountInBase), fxCode)
    if (currencyMode === 'fx') {
      return { primary: fxFormatted }
    }
    return { primary: baseFormatted, secondary: fxFormatted }
  }

  // Productos visibles para el catálogo (respeta catalog_visible !== false)
  const catalogEligibleProducts = useMemo(
    () => products.filter(p => p.catalog_visible !== false),
    [products]
  )

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase()
    return catalogEligibleProducts.filter(p => {
      if (categoryFilter !== 'all' && (p.category_id || 'uncategorized') !== categoryFilter) {
        return false
      }
      if (filterMode === 'disponibles' && Number(p.stock) <= 0) return false
      if (filterMode === 'destacados' && !p.featured) return false
      if (filterMode === 'seleccionados' && !selectedIds.has(p.id)) return false
      if (q) {
        const catName = (p.category_id && categoryMap.get(p.category_id)) || ''
        const hay = `${p.name} ${p.sku || ''} ${p.description || ''} ${catName}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [catalogEligibleProducts, categoryFilter, filterMode, selectedIds, search, categoryMap])

  // Productos que saldrán al exportar PDF o enviar por WhatsApp:
  // si el vendedor marcó una selección personalizada y hay elementos marcados, prioriza esos dentro del filtro o toda la selección
  const exportProducts = useMemo(() => {
    if (selectedIds.size > 0 && filterMode !== 'seleccionados') {
      const picked = filteredProducts.filter(p => selectedIds.has(p.id))
      if (picked.length > 0) return picked
    }
    return filteredProducts
  }, [filteredProducts, selectedIds, filterMode])

  const groupedByCategory = useMemo(() => {
    const groups = new Map<string, Product[]>()
    for (const p of exportProducts) {
      const label = (p.category_id && categoryMap.get(p.category_id)) || 'General'
      const list = groups.get(label) || []
      list.push(p)
      groups.set(label, list)
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'es'))
  }, [exportProducts, categoryMap])

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of catalogEligibleProducts) {
      if (filterMode === 'disponibles' && Number(p.stock) <= 0) continue
      const key = p.category_id || 'uncategorized'
      counts.set(key, (counts.get(key) || 0) + 1)
    }
    return counts
  }, [catalogEligibleProducts, filterMode])

  const photosCount = useMemo(
    () => catalogEligibleProducts.filter(p => Boolean(p.image_url?.trim())).length,
    [catalogEligibleProducts]
  )

  function toggleSelectProduct(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    setSelectedIds(new Set(filteredProducts.map(p => p.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
    if (filterMode === 'seleccionados') setFilterMode('disponibles')
  }

  // Gestión de foto real desde el visor del catálogo
  async function handleUpdateProductPhoto(productId: string, newImageUrl: string | null) {
    const targetProd = products.find(p => p.id === productId)
    const { savedUrl } = await saveProductImageInSupabase({
      productId,
      companyId: companyId || null,
      skuOrName: targetProd?.sku || targetProd?.name || productId,
      imageUrl: newImageUrl,
    })
    setImageSchemaMissing(false)
    setProducts(prev =>
      prev.map(p => (p.id === productId ? { ...p, image_url: savedUrl } : p))
    )
    notify(
      savedUrl
        ? 'Fotografía guardada en Supabase y lista para PDF / POS.'
        : 'Fotografía eliminada.'
    )
  }

  // Armador rápido de pedido / cotización
  const draftQtyByProduct = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of draftItems) m.set(it.product_id, it.quantity)
    return m
  }, [draftItems])

  function addDraftItem(productId: string, delta = 1) {
    setDraftItems(prev => {
      const existing = prev.find(i => i.product_id === productId)
      if (!existing) {
        if (delta <= 0) return prev
        return [...prev, { product_id: productId, quantity: delta }]
      }
      const nextQty = existing.quantity + delta
      if (nextQty <= 0) return prev.filter(i => i.product_id !== productId)
      return prev.map(i => (i.product_id === productId ? { ...i, quantity: nextQty } : i))
    })
  }

  function setDraftItemQty(productId: string, qty: number) {
    const clean = Math.max(0, Math.floor(qty || 0))
    if (clean <= 0) {
      setDraftItems(prev => prev.filter(i => i.product_id !== productId))
      return
    }
    setDraftItems(prev =>
      prev.some(i => i.product_id === productId)
        ? prev.map(i => (i.product_id === productId ? { ...i, quantity: clean } : i))
        : [...prev, { product_id: productId, quantity: clean }]
    )
  }

  const proposalCustomer = useMemo(
    () => customers.find(c => c.id === proposalCustomerId),
    [customers, proposalCustomerId]
  )

  const proposalPriceType: PriceType =
    proposalCustomer?.price_type === 'mayor' || priceMode === 'mayor' ? 'mayor' : 'detal'
  const proposalDiscFactor =
    1 - Math.min(100, Math.max(0, Number(proposalDiscountPct) || 0)) / 100

  const proposalLines = useMemo(() => {
    return draftItems
      .map(item => {
        const prod = products.find(p => p.id === item.product_id)
        if (!prod) return null
        const base = priceFor(prod, item.quantity, proposalPriceType)
        const unitPrice = round2(base.price * proposalDiscFactor)
        return {
          product: prod,
          product_id: prod.id,
          product_name: prod.name,
          quantity: item.quantity,
          price: unitPrice,
          subtotal: round2(unitPrice * item.quantity),
          mayor: base.mayor,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
  }, [draftItems, products, proposalPriceType, proposalDiscFactor])

  const proposalSum = round2(proposalLines.reduce((acc, l) => acc + l.subtotal, 0))
  const proposalTax = calcTax(proposalSum, taxModeOf(config), taxRateOf(config))
  const totalDraftUnits = draftItems.reduce((acc, i) => acc + i.quantity, 0)

  function handleSendDraftToPos() {
    if (proposalLines.length === 0) return
    setCatalogPosHandoff({
      customerId: proposalCustomerId || null,
      items: proposalLines.map(l => ({ product_id: l.product_id, quantity: l.quantity })),
    })
    setShowProposalDrawer(false)
    if (onNavigate) {
      onNavigate('pos')
    } else {
      notify('Productos listos para cobrar en Mostrador (POS).')
    }
  }

  function buildProposalDoc(numberLabel = 'PROP-CAT'): DocData {
    const days = Math.max(1, parseInt(proposalValidDays) || 7)
    const validDate = new Date(Date.now() + days * 86400000).toLocaleDateString('es-ES')
    return {
      title: 'PROPUESTA COMERCIAL',
      number: numberLabel,
      date: new Date().toLocaleDateString('es-ES'),
      extra: `Válida hasta: ${validDate} · Asesor: ${advisorName}`,
      partyName: proposalCustomer?.name || 'Cliente comercial',
      partyLines: [
        proposalCustomer?.document && `Documento: ${proposalCustomer.document}`,
        proposalCustomer?.phone && `Tel: ${proposalCustomer.phone}`,
        proposalCustomer?.email,
      ],
      lines: proposalLines.map(l => ({
        name: l.product_name,
        quantity: l.quantity,
        price: l.price,
        subtotal: l.subtotal,
      })),
      ...taxDocFields({
        subtotal: proposalTax.subtotal,
        tax_rate: proposalTax.rate,
        tax_amount: proposalTax.tax,
      }),
      total: proposalTax.total,
      footer: customNote || 'Propuesta generada desde el Catálogo Comercial.',
    }
  }

  async function handleSaveFormalQuotation(andPrint = false) {
    if (!canSell || proposalLines.length === 0 || savingQuotation) return
    setSavingQuotation(true)
    const days = Math.max(1, parseInt(proposalValidDays) || 7)
    const validUntil = toDateStr(new Date(Date.now() + days * 86400000))
    const payload = {
      customer_id: proposalCustomerId || null,
      customer_name: proposalCustomer?.name || null,
      items: proposalLines.map(l => ({
        product_id: l.product_id,
        product_name: l.product_name,
        quantity: l.quantity,
        price: l.price,
        subtotal: l.subtotal,
      })),
      total: proposalTax.total,
      subtotal: proposalTax.subtotal,
      tax_rate: proposalTax.rate,
      tax_amount: proposalTax.tax,
      valid_until: validUntil,
      status: 'enviada',
    }
    const { data, error } = await supabase
      .from('quotations')
      .insert(payload)
      .select('*')
      .single()
    setSavingQuotation(false)
    if (error) {
      notify('No se pudo guardar la cotización: ' + error.message, 'err')
      return
    }
    const code = data?.id ? 'COT-' + String(data.id).slice(0, 8).toUpperCase() : 'COT-NUEVA'
    notify(`Cotización ${code} guardada en Cotizaciones.`)
    if (andPrint) {
      printHtml(buildDocHtml(buildProposalDoc(code), config))
    }
  }

  // Construcción del listado de productos para insertar en plantillas de WhatsApp / Correo
  function buildProductLinesForWhatsApp(): string {
    const maxLines = 18
    const sample = exportProducts.slice(0, maxLines)
    const itemLines = sample.map(p => {
      const retail = Number(p.price) || 0
      const wholesale = Number(p.price_wholesale) || 0
      let pricePart = ''
      if (priceMode === 'detal') {
        const f = formatCatalogPrice(retail)
        pricePart = ` — *${f.primary}*${f.secondary ? ` (${f.secondary})` : ''}`
      } else if (priceMode === 'mayor') {
        const val = wholesale > 0 ? wholesale : retail
        const f = formatCatalogPrice(val)
        pricePart = ` — Mayor: *${f.primary}*${f.secondary ? ` (${f.secondary})` : ''}`
      } else if (priceMode === 'ambos') {
        const fDet = formatCatalogPrice(retail)
        const fMay = wholesale > 0 ? formatCatalogPrice(wholesale) : null
        pricePart = ` — Detal: *${fDet.primary}*${fMay ? ` | Mayor: *${fMay.primary}*` : ''}`
      }
      const stockNote =
        showStockInCatalog && Number(p.stock) > 0 ? ` (${p.stock} ${p.unit || 'und'})` : ''
      const vars = normalizeProductVariants(p.variants)
      const varNote = vars.length > 0 ? ` · Presentaciones: ${vars.map(v => v.label).join(', ')}` : ''
      return `• ${p.name}${p.sku ? ` [${p.sku}]` : ''}${pricePart}${stockNote}${varNote}`
    })

    if (exportProducts.length > maxLines) {
      itemLines.push(`…y *${exportProducts.length - maxLines} productos adicionales* en el catálogo completo.`)
    }
    return itemLines.join('\n')
  }

  // Construcción del texto comercial personalizado de la empresa para WhatsApp / Correo / Portapapeles
  function buildCommercialShareMessage(
    customerName?: string,
    scenarioOverride?: WhatsAppTemplateScenario
  ): string {
    const targetScenario = scenarioOverride || waScenario
    return renderCompanyWhatsAppMessage(targetScenario, {
      config,
      companyName,
      storeUrl: publicCatalogUrl,
      customerName,
      advisorName,
      advisorPhone,
      catalogTitle: customTitle,
      productLinesText: buildProductLinesForWhatsApp(),
      commercialNote: customNote,
    })
  }

  function openWhatsAppComposer(
    preselectedCustomer?: Customer,
    scenarioOverride?: WhatsAppTemplateScenario
  ) {
    const nextScenario = scenarioOverride || waScenario
    if (
      exportProducts.length === 0 &&
      nextScenario !== 'store_invite' &&
      nextScenario !== 'quick_payment_info'
    ) {
      notify('No hay productos visibles para compartir en este filtro.', 'err')
      return
    }
    const cust = preselectedCustomer || customers.find(c => c.id === waCustomerId)
    if (preselectedCustomer) {
      setWaCustomerId(preselectedCustomer.id)
      setWaCustomPhone(preselectedCustomer.phone || '')
    }
    setWaScenario(nextScenario)
    setWaCustomText(buildCommercialShareMessage(cust?.name, nextScenario))
    setShowWhatsAppModal(true)
  }

  function handleChangeWaScenario(nextScenario: WhatsAppTemplateScenario) {
    setWaScenario(nextScenario)
    const cust = customers.find(c => c.id === waCustomerId)
    setWaCustomText(buildCommercialShareMessage(cust?.name, nextScenario))
  }

  function handleSelectWaCustomer(custId: string) {
    setWaCustomerId(custId)
    const cust = customers.find(c => c.id === custId)
    setWaCustomPhone(cust?.phone || '')
    setWaCustomText(buildCommercialShareMessage(cust?.name, waScenario))
  }

  // Generación del documento HTML tipo revista corporativa para exportar a PDF
  function buildCatalogPrintHtml(): string {
    const brand = resolveBrandTheme(config?.brand_theme)
    const customLogo = resolvePrintImageUrl(config?.logo_url)
    const issuedAt = new Date().toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })

    const currencySummary =
      priceMode === 'oculto'
        ? 'Edición vitrina técnica (sin precios)'
        : currencyMode === 'fx' && hasValidFx
          ? `Precios expresados en ${fxCode} (Tasa ref. 1 ${fxCode} = ${fxRateNum} ${baseCur})`
          : currencyMode === 'dual' && hasValidFx
            ? `Doble moneda: ${baseCur} y ${fxCode} (Tasa 1 ${fxCode} = ${fxRateNum} ${baseCur})`
            : `Precios expresados en ${baseCur}`

    const sectionsHtml = groupedByCategory
      .map(([catName, items]) => {
        const cardsHtml = items
          .map(p => {
            const imgUrl = resolvePrintImageUrl(p.image_url)
            const monogram = esc(getProductMonogram(p.name))
            const retail = Number(p.price) || 0
            const wholesale = Number(p.price_wholesale) || 0
            const minQty = Number(p.wholesale_min_qty) || 0

            let pricingHtml = ''
            if (priceMode === 'detal') {
              const f = formatCatalogPrice(retail)
              pricingHtml = `
                <div class="price-box">
                  <div class="price-row">
                    <span class="price-lbl">Precio</span>
                    <span class="price-main">${esc(f.primary)}</span>
                  </div>
                  ${f.secondary ? `<div class="price-fx">${esc(f.secondary)}</div>` : ''}
                </div>`
            } else if (priceMode === 'mayor') {
              const val = wholesale > 0 ? wholesale : retail
              const f = formatCatalogPrice(val)
              pricingHtml = `
                <div class="price-box">
                  <div class="price-row">
                    <span class="price-lbl">${wholesale > 0 ? `Mayor${minQty > 0 ? ` (≥${minQty})` : ''}` : 'Precio'}</span>
                    <span class="price-main">${esc(f.primary)}</span>
                  </div>
                  ${f.secondary ? `<div class="price-fx">${esc(f.secondary)}</div>` : ''}
                </div>`
            } else if (priceMode === 'ambos') {
              const fDet = formatCatalogPrice(retail)
              const fMay = wholesale > 0 ? formatCatalogPrice(wholesale) : null
              pricingHtml = `
                <div class="price-box">
                  <div class="price-row">
                    <span class="price-lbl">Detal</span>
                    <span class="price-main">${esc(fDet.primary)}</span>
                  </div>
                  ${fMay ? `
                  <div class="price-row mayor-row">
                    <span class="price-lbl">Mayor${minQty > 0 ? ` ≥${minQty}` : ''}</span>
                    <span class="price-mayor">${esc(fMay.primary)}</span>
                  </div>` : ''}
                </div>`
            }

            const stockBadge = showStockInCatalog
              ? Number(p.stock) > 0
                ? `<span class="stock-ok">Disp: ${Number(p.stock)} ${esc(p.unit || 'und')}</span>`
                : `<span class="stock-out">Bajo pedido</span>`
              : ''

            const variants = normalizeProductVariants(p.variants)
            const variantsHtml =
              variants.length > 0
                ? `<div class="var-list"><strong>${esc(p.variant_group_label || 'Presentaciones')}:</strong> ${variants
                    .map(v => {
                      if (priceMode === 'oculto') return esc(v.label)
                      const vVal =
                        priceMode === 'mayor' && v.price_wholesale && v.price_wholesale > 0
                          ? v.price_wholesale
                          : v.price
                      return `${esc(v.label)} (${esc(formatCatalogPrice(vVal).primary)})`
                    })
                    .join(' · ')}</div>`
                : ''

            return `
              <article class="card">
                <div class="thumb-wrap">
                  ${
                    imgUrl
                      ? `<img src="${esc(imgUrl)}" alt="${esc(p.name)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />
                         <div class="thumb-fallback" style="display:none"><span>${monogram}</span></div>`
                      : `<div class="thumb-fallback"><span>${monogram}</span></div>`
                  }
                  ${p.featured ? `<span class="feat-badge">Destacado</span>` : ''}
                </div>
                <div class="card-body">
                  <div class="meta-line">
                    <span class="sku">${esc(p.sku || 'SIN SKU')}</span>
                    ${stockBadge}
                  </div>
                  <h3 class="prod-name">${esc(p.name)}</h3>
                  ${p.description ? `<p class="prod-desc">${esc(p.description)}</p>` : ''}
                  ${variantsHtml}
                  ${pricingHtml}
                </div>
              </article>
            `
          })
          .join('')

        return `
          <section class="cat-section">
            <div class="cat-head">
              <h2>${esc(catName)}</h2>
              <span>${items.length} ${items.length === 1 ? 'producto' : 'productos'}</span>
            </div>
            <div class="grid">${cardsHtml}</div>
          </section>
        `
      })
      .join('')

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${esc(customTitle || 'Catálogo Comercial')} — ${esc(companyName)}</title>
  <style>
    @page { size: A4 portrait; margin: 11mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      margin: 0;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 11px;
      line-height: 1.4;
    }
    .banner {
      background: ${brand.hexDark};
      color: #f8fafc;
      border-radius: 14px;
      padding: 18px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .banner-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .banner-logo {
      width: 50px; height: 50px; border-radius: 10px; background: #ffffff; padding: 5px; object-fit: contain; flex-shrink: 0;
    }
    .co-kicker {
      font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #e2e8f0; font-weight: 700; margin-bottom: 2px;
    }
    .banner h1 { margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.02em; color: #ffffff; }
    .co-sub { margin-top: 3px; font-size: 10.5px; color: #cbd5e1; }
    .banner-right {
      display: flex; align-items: center; gap: 12px; flex-shrink: 0; text-align: right;
    }
    .advisor-box {
      background: rgba(255,255,255,0.09);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 10px;
      color: #e2e8f0;
    }
    .advisor-box strong { display: block; font-size: 11.5px; color: #ffffff; margin-bottom: 2px; }
    .qr-box {
      width: 62px; height: 62px; background: #ffffff; border-radius: 8px; padding: 4px; display: flex; align-items: center; justify-content: center;
    }
    .qr-box svg { width: 100%; height: 100%; display: block; }
    .info-strip {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
      padding: 8px 12px; margin-bottom: 16px; font-size: 10px; color: #475569;
    }
    .info-strip strong { color: #0f172a; }
    .cat-section { margin-bottom: 18px; }
    .cat-head {
      display: flex; align-items: baseline; justify-content: space-between;
      border-bottom: 1.5px solid ${brand.hexDark}; padding-bottom: 4px; margin-bottom: 10px;
      break-after: avoid;
    }
    .cat-head h2 { margin: 0; font-size: 13px; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; }
    .cat-head span { font-size: 10px; color: #64748b; font-weight: 600; }
    .grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }
    .card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      background: #ffffff;
      display: flex;
      flex-direction: column;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .thumb-wrap {
      position: relative;
      width: 100%;
      height: 138px;
      min-height: 138px;
      max-height: 138px;
      background: #ffffff;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .thumb-wrap img {
      display: block;
      width: 100%;
      height: 138px;
      max-width: 100%;
      max-height: 138px;
      object-fit: contain;
      padding: 6px;
      background: #ffffff;
    }
    .thumb-fallback {
      width: 100%;
      height: 138px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f1f5f9;
      color: #64748b;
      font-weight: 700;
      font-size: 18px;
      letter-spacing: 0.04em;
    }
    .feat-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      background: ${brand.hex};
      color: #ffffff;
      font-size: 8.5px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 5px;
      letter-spacing: 0.02em;
    }
    .card-body {
      padding: 8px 10px 10px;
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .meta-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      font-size: 9px;
      color: #64748b;
      margin-bottom: 3px;
      font-variant-numeric: tabular-nums;
    }
    .sku { font-family: 'JetBrains Mono', monospace; color: #64748b; }
    .stock-ok { color: #047857; font-weight: 600; }
    .stock-out { color: #b45309; font-weight: 600; }
    .prod-name {
      margin: 0 0 3px;
      font-size: 11.5px;
      font-weight: 700;
      color: #0f172a;
      line-height: 1.25;
    }
    .prod-desc {
      margin: 0 0 5px;
      font-size: 9.5px;
      color: #64748b;
      line-height: 1.3;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .var-list {
      margin: 0 0 6px;
      padding: 4px 6px;
      border-radius: 5px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-size: 8.8px;
      color: #334155;
      line-height: 1.35;
      font-variant-numeric: tabular-nums;
    }
    .var-list strong { color: #0f172a; }
    .price-box {
      margin-top: auto;
      padding-top: 6px;
      border-top: 1px solid #f1f5f9;
      font-variant-numeric: tabular-nums;
    }
    .price-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 6px;
    }
    .mayor-row { margin-top: 2px; }
    .price-lbl { font-size: 9px; color: #64748b; font-weight: 600; text-transform: uppercase; }
    .price-main { font-size: 12.5px; font-weight: 800; color: #0f172a; }
    .price-mayor { font-size: 11px; font-weight: 700; color: ${brand.hex}; }
    .price-fx { text-align: right; font-size: 9.5px; color: #475569; font-weight: 600; margin-top: 1px; }
    .doc-footer {
      margin-top: 16px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 9.5px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <header class="banner">
    <div class="banner-left">
      ${
        customLogo
          ? `<img class="banner-logo" src="${esc(customLogo)}" alt="" onerror="this.style.display='none'" />`
          : `<div class="banner-logo" style="display:flex;align-items:center;justify-content:center;background:${brand.hex};color:#ffffff;font-weight:800;font-size:16px;">${esc(companyName.slice(0, 2).toUpperCase())}</div>`
      }
      <div>
        <div class="co-kicker">${esc(companyName)}${config?.rif ? ` · ${esc(config.rif)}` : ''}</div>
        <h1>${esc(customTitle.trim() || 'Catálogo Comercial de Productos')}</h1>
        <div class="co-sub">
          Emitido el ${esc(issuedAt)} · ${exportProducts.length} ${exportProducts.length === 1 ? 'producto' : 'productos'} · ${esc(currencySummary)}
        </div>
      </div>
    </div>
    <div class="banner-right">
      <div class="advisor-box">
        <strong>${esc(advisorName)}</strong>
        ${advisorPhone.trim() ? `<div>Tel / WhatsApp: ${esc(advisorPhone.trim())}</div>` : ''}
        ${user?.email ? `<div>${esc(user.email)}</div>` : ''}
      </div>
      ${catalogQrMarkup ? `<div class="qr-box" title="Catálogo digital">${catalogQrMarkup}</div>` : ''}
    </div>
  </header>

  ${
    customNote.trim()
      ? `<div class="info-strip">
          <div><strong>Condiciones comerciales:</strong> ${esc(customNote.trim())}</div>
          ${config?.address ? `<div>${esc(config.address)}</div>` : ''}
        </div>`
      : ''
  }

  ${sectionsHtml}

  <footer class="doc-footer">
    <div>${esc(companyName)}${config?.phone ? ` · ${esc(config.phone)}` : ''}${config?.email ? ` · ${esc(config.email)}` : ''}</div>
    <div>Catálogo generado desde InventarioPro</div>
  </footer>
</body>
</html>`
  }

  function handleExportPdf() {
    if (exportProducts.length === 0) {
      notify('No hay productos para exportar con los filtros actuales.', 'err')
      return
    }
    printHtml(buildCatalogPrintHtml())
  }

  async function handleNativeShare() {
    if (exportProducts.length === 0) {
      notify('No hay productos visibles para compartir.', 'err')
      return
    }
    const text = buildCommercialShareMessage()
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: `${customTitle || 'Catálogo Comercial'} · ${companyName}`,
          text,
          url: companyId ? publicCatalogUrl : undefined,
        })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    const ok = await copyToClipboard(text)
    notify(
      ok
        ? 'Resumen comercial copiado al portapapeles listo para pegar.'
        : 'No fue posible compartir directamente desde este dispositivo.',
      ok ? 'ok' : 'err'
    )
  }

  async function handleShareInteractiveHtmlFile() {
    if (exportProducts.length === 0) return
    const htmlContent = buildCatalogPrintHtml()
    const fileName = `catalogo_${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${toDateStr(new Date())}.html`

    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
      try {
        const file = new File([htmlContent], fileName, { type: 'text/html' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: `${customTitle || 'Catálogo'} · ${companyName}`,
            text: `Catálogo digital con fotos de ${companyName}`,
            files: [file],
          })
          return
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }

    // Descarga directa como archivo HTML autónomo si el navegador no soporta compartir archivos
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(url), 5000)
    notify('Ficha de catálogo descargada lista para adjuntar por WhatsApp o correo.')
  }

  async function handleCopySummary() {
    const ok = await copyToClipboard(buildCommercialShareMessage())
    notify(
      ok ? 'Catálogo comercial copiado al portapapeles.' : 'No se pudo copiar al portapapeles.',
      ok ? 'ok' : 'err'
    )
  }

  async function handleCopyLink() {
    const ok = await copyToClipboard(publicCatalogUrl)
    notify(
      ok ? 'Enlace del catálogo digital copiado.' : 'No se pudo copiar el enlace.',
      ok ? 'ok' : 'err'
    )
  }

  function handleForceRefreshWhatsAppCache() {
    const salt = Math.random().toString(36).slice(2, 7)
    setUrlCacheBuster(salt)
    const freshUrl = buildCompanyStoreUrl(
      window.location.origin,
      companyId,
      config?.catalog_slug,
      config,
      salt
    )
    void copyToClipboard(freshUrl)
    notify(
      `¡Enlace renovado sin caché para ${companyName}! Copiado al portapapeles. Al enviarlo por WhatsApp cargará tu nuevo nombre y logo de inmediato.`,
      'ok'
    )
  }

  // Producto actualmente abierto en el visor de foto real
  const lightboxProduct = useMemo<LightboxProductInfo | null>(() => {
    if (!lightboxProductId) return null
    const p = products.find(x => x.id === lightboxProductId)
    if (!p) return null
    const retail = formatCatalogPrice(Number(p.price) || 0)
    const wholesale =
      Number(p.price_wholesale) > 0
        ? formatCatalogPrice(Number(p.price_wholesale))
        : null
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      categoryName: (p.category_id && categoryMap.get(p.category_id)) || 'General',
      description: p.description,
      unit: p.unit,
      priceLabel: priceMode === 'oculto' ? null : retail.primary,
      wholesaleLabel:
        priceMode === 'oculto' || !wholesale
          ? null
          : `${wholesale.primary}${p.wholesale_min_qty ? ` (desde ${p.wholesale_min_qty})` : ''}`,
      fxLabel: priceMode === 'oculto' ? null : retail.secondary || null,
      stockLabel: `${p.stock} ${p.unit || 'und'} disponibles`,
      outOfStock: Number(p.stock) <= 0,
      image_url: p.image_url,
    }
  }, [lightboxProductId, products, categoryMap, priceMode, currencyMode, fxCode, fxRateInput])

  const mailtoHref = useMemo(() => {
    const subject = `${customTitle || 'Catálogo Comercial'} - ${companyName}`
    const body = buildCommercialShareMessage()
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }, [customTitle, companyName, exportProducts, priceMode, currencyMode, fxCode, fxRateInput, customNote, advisorPhone])

  const cleanWaDigits = cleanPhoneForWhatsApp(waCustomPhone)
  const whatsAppHref = useMemo(() => {
    const base = cleanWaDigits ? `https://wa.me/${cleanWaDigits}` : 'https://wa.me/'
    return `${base}?text=${encodeURIComponent(waCustomText || buildCommercialShareMessage())}`
  }, [cleanWaDigits, waCustomText, exportProducts])

  const filteredWaCustomers = useMemo(() => {
    const q = waSearchCustomer.trim().toLowerCase()
    if (!q) return customers.slice(0, 30)
    return customers
      .filter(
        c =>
          c.name.toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q) ||
          (c.document || '').toLowerCase().includes(q)
      )
      .slice(0, 30)
  }, [customers, waSearchCustomer])

  const storeCardPreview = useMemo(
    () =>
      buildStorePreviewCardSummary({
        companyName,
        rif: config?.rif,
        welcome: config?.catalog_welcome,
        whatsappSettings: config?.whatsapp_settings,
        storeUrl: publicCatalogUrl,
        productsCount: catalogEligibleProducts.length,
      }),
    [
      companyName,
      config?.rif,
      config?.catalog_welcome,
      config?.whatsapp_settings,
      publicCatalogUrl,
      catalogEligibleProducts.length,
    ]
  )

  const activeBrandTheme = useMemo(
    () => resolveBrandTheme(config?.brand_theme),
    [config?.brand_theme]
  )

  return (
    <div className="space-y-5 pb-20">
      {imageSchemaMissing && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Tabla de imágenes pendiente en Supabase:</strong> ejecuta el script SQL de{' '}
              <code className="font-mono">product_images</code> para que las fotografías cargadas en POS y Productos aparezcan en el PDF y persistan al recargar.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSqlModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <Database className="w-3.5 h-3.5" /> Activar SQL de Imágenes
          </button>
        </div>
      )}

      {/* Encabezado Ejecutivo y Barra Multicanal de Exportación */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {config?.logo_url && (
              <img
                src={config.logo_url}
                alt={companyName}
                className="w-12 h-12 rounded-xl border border-slate-200 bg-white object-contain p-1 shrink-0"
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 mb-1">
                <span>{companyName}</span>
                <span className="text-slate-300">•</span>
                <span className="text-slate-500 font-medium">Asesor: {advisorName}</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                Catálogo Comercial y Lista de Precios
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Vitrina corporativa con cualidades (tallas, ml, L, kg), autogestión de pedidos con capture de pago, PDF y WhatsApp.
              </p>
            </div>
          </div>

          {/* Botonera principal de exportación y canales */}
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('catorders')}
                className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-sm font-semibold transition-colors whitespace-nowrap tabular-nums"
                title="Revisar pedidos recibidos del catálogo y corroborar captures de pago"
              >
                <ClipboardCheck className="w-4 h-4 text-emerald-700" />
                Pedidos web{pendingOrdersCount > 0 ? ` (${pendingOrdersCount})` : ''}
              </button>
            )}

            {(canManageSettings(user?.role) || canManageInventory(user?.role)) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setBrandModalInitialTab('brand')
                    setBrandModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
                  title="Configurar logo corporativo, color de identidad y métodos de pago"
                >
                  <Palette className="w-4 h-4 text-slate-600" />
                  Identidad y Pagos
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBrandModalInitialTab('whatsapp')
                    setBrandModalOpen(true)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
                  title="Configurar enlace propio /tienda/... con tu logo y plantillas de WhatsApp"
                >
                  <Globe className="w-4 h-4 text-emerald-700" />
                  Enlace y WhatsApp
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleExportPdf}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <Printer className="w-4 h-4" />
              Exportar PDF
            </button>

            <button
              type="button"
              onClick={() => openWhatsAppComposer()}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold transition-colors whitespace-nowrap"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </button>

            <button
              type="button"
              onClick={() => void handleNativeShare()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
              title="Compartir mediante el menú del dispositivo"
            >
              <Share2 className="w-4 h-4 text-slate-500" />
              Compartir
            </button>

            <a
              href={mailtoHref}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
              title="Enviar resumen del catálogo por correo electrónico"
            >
              <Mail className="w-4 h-4 text-slate-500" />
              Correo
            </a>

            <button
              type="button"
              onClick={() => void handleCopySummary()}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
              title="Copiar texto comercial al portapapeles"
            >
              <Copy className="w-4 h-4 text-slate-500" />
              Copiar
            </button>

            <button
              type="button"
              onClick={() => setShowQrModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium transition-colors whitespace-nowrap"
              title="Código QR y enlace del catálogo público"
            >
              <QrCode className="w-4 h-4 text-slate-500" />
              QR
            </button>
          </div>
        </div>

        {/* Métricas rápidas de curaduría */}
        <div className="mt-4 pt-3.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 tabular-nums">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              <strong className="text-slate-900 font-semibold">{exportProducts.length}</strong> productos en vista/PDF
            </span>
            <span>
              <strong className="text-slate-900 font-semibold">{photosCount}</strong> de {catalogEligibleProducts.length} con foto real
            </span>
            {selectedIds.size > 0 && (
              <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                <CheckSquare className="w-3.5 h-3.5" />
                {selectedIds.size} seleccionados para catálogo a medida
                <button
                  type="button"
                  onClick={clearSelection}
                  className="underline text-slate-500 hover:text-slate-800 font-normal ml-1"
                >
                  Limpiar
                </button>
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {companyId && onPreviewCatalog && (
              <button
                type="button"
                onClick={() => onPreviewCatalog(config?.catalog_slug || companyId)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Ver vitrina pública
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCustomizeBar(v => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap ${
                showCustomizeBar
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Personalizar PDF y moneda
            </button>
          </div>
        </div>

        {/* Panel desplegable de personalización comercial y multimoneda */}
        {showCustomizeBar && (
          <div className="mt-4 pt-4 border-t border-slate-200 grid grid-cols-1 md:grid-cols-12 gap-3 bg-slate-50/70 -mx-4 sm:-mx-5 -mb-4 sm:-mb-5 p-4 sm:p-5 rounded-b-xl">
            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Título de portada (PDF y WhatsApp)
              </label>
              <input
                type="text"
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                placeholder="Ej: Catálogo Mayorista Octubre"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="md:col-span-5">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nota o condiciones comerciales
              </label>
              <input
                type="text"
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="Ej: Despacho sin costo a partir de 12 unidades"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="md:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Teléfono / WhatsApp del asesor
              </label>
              <input
                type="text"
                value={advisorPhone}
                onChange={e => setAdvisorPhone(e.target.value)}
                placeholder="Ej: +58 412 0000000"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              />
            </div>

            <div className="md:col-span-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Visualización de moneda
              </label>
              <select
                value={currencyMode}
                onChange={e => setCurrencyMode(e.target.value as CurrencyDisplayMode)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
              >
                <option value="base">Solo moneda base ({baseCur})</option>
                <option value="fx">Convertir precios a otra moneda</option>
                <option value="dual">Doble moneda ({baseCur} + divisa)</option>
              </select>
            </div>

            {currencyMode !== 'base' && (
              <>
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Moneda secundaria
                  </label>
                  <select
                    value={fxCode}
                    onChange={e => setFxCode(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900"
                  >
                    {CURRENCIES.filter(c => c.code !== baseCur).map(c => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Tasa (1 {fxCode} = ? {baseCur})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={fxRateInput}
                    onChange={e => setFxRateInput(e.target.value)}
                    placeholder="Ej: 4000"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm text-slate-900 tabular-nums"
                  />
                </div>
              </>
            )}

            <div className="md:col-span-2 flex items-end">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer py-2">
                <input
                  type="checkbox"
                  checked={showStockInCatalog}
                  onChange={e => setShowStockInCatalog(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-slate-900"
                />
                Mostrar stock disponible
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Notificación en línea */}
      {feedback && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium ${
            feedback.tone === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Barra de Búsqueda, Tarifa y Curaduría */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto por nombre, código SKU, descripción o categoría..."
              className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 focus:border-slate-400 focus:outline-none text-sm text-slate-900"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de tarifa */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-medium">
              {(
                [
                  { id: 'detal', label: 'Detal' },
                  { id: 'mayor', label: 'Mayorista' },
                  { id: 'ambos', label: 'Detal + Mayor' },
                  { id: 'oculto', label: 'Sin precios' },
                ] as { id: CatalogPriceMode; label: string }[]
              ).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setPriceMode(opt.id)}
                  className={`px-2.5 py-1.5 rounded-md transition-colors whitespace-nowrap ${
                    priceMode === opt.id
                      ? 'bg-white text-slate-900 shadow-sm font-semibold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Selector de vista */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                  viewMode === 'grid'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Fotos
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-sm font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <List className="w-3.5 h-3.5" />
                Lista
              </button>
            </div>
          </div>
        </div>

        {/* Filtros de disponibilidad + Selección rápida + Categorías */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'disponibles', label: 'Disponibles' },
                { id: 'todos', label: 'Todos' },
                { id: 'destacados', label: 'Destacados' },
                { id: 'seleccionados', label: `Seleccionados (${selectedIds.size})` },
              ] as { id: CatalogFilterMode; label: string }[]
            ).map(f => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterMode(f.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap tabular-nums ${
                  filterMode === f.id
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {f.label}
              </button>
            ))}

            <button
              type="button"
              onClick={selectAllVisible}
              className="px-2.5 py-1 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 whitespace-nowrap"
            >
              Marcar visibles
            </button>
          </div>

          {/* Categorías */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                categoryFilter === 'all'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold'
                  : 'text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
            >
              Todas las categorías
            </button>
            {categories.map(cat => {
              const count = categoryCounts.get(cat.id) || 0
              if (count === 0 && categoryFilter !== cat.id) return null
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors tabular-nums ${
                    categoryFilter === cat.id
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  {cat.name} ({count})
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Contenido Principal del Catálogo */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="bg-white border border-slate-200 rounded-xl overflow-hidden animate-pulse">
              <div className="aspect-[4/3] bg-slate-100" />
              <div className="p-4 space-y-2.5">
                <div className="h-3 bg-slate-100 rounded w-1/3" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-5 bg-slate-100 rounded w-1/2 mt-3" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <p className="text-base font-semibold text-slate-900">
            No encontramos productos con este filtro
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Prueba mostrando todos los productos o limpiando la búsqueda actual.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setCategoryFilter('all')
              setFilterMode('todos')
            }}
            className="mt-4 px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-800"
          >
            Mostrar todos los productos
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredProducts.map(p => {
            const isSelected = selectedIds.has(p.id)
            const inDraftQty = draftQtyByProduct.get(p.id) || 0
            const retailFmt = formatCatalogPrice(Number(p.price) || 0)
            const hasMayor = Number(p.price_wholesale) > 0
            const mayorFmt = hasMayor
              ? formatCatalogPrice(Number(p.price_wholesale) || 0)
              : null
            const outOfStock = Number(p.stock) <= 0
            const catLabel = (p.category_id && categoryMap.get(p.category_id)) || 'General'

            return (
              <article
                key={p.id}
                className={`group bg-white rounded-xl border transition-colors flex flex-col overflow-hidden ${
                  isSelected
                    ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Contenedor visual 4:3 de estudio */}
                <div className="relative bg-slate-50 border-b border-slate-100">
                  <button
                    type="button"
                    onClick={() => setLightboxProductId(p.id)}
                    className="block w-full text-left focus:outline-none"
                    title="Ver fotografía real del producto"
                  >
                    <ProductThumb
                      src={p.image_url}
                      name={p.name}
                      size="card"
                      fit="contain"
                      className="border-0 rounded-none"
                    />
                  </button>

                  {/* Selector para catálogo personalizado */}
                  <button
                    type="button"
                    onClick={() => toggleSelectProduct(p.id)}
                    title={isSelected ? 'Quitar de mi selección' : 'Incluir en selección a medida'}
                    className={`absolute top-2.5 left-2.5 w-7 h-7 rounded-lg flex items-center justify-center border transition-colors ${
                      isSelected
                        ? 'bg-emerald-600 border-emerald-600 text-white'
                        : 'bg-white/95 border-slate-200 text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {isSelected ? <Check className="w-4 h-4" /> : <Square className="w-3.5 h-3.5" />}
                  </button>

                  {/* Botón explícito para ver o cargar imagen real */}
                  <button
                    type="button"
                    onClick={() => setLightboxProductId(p.id)}
                    title={p.image_url ? 'Ver foto real ampliada' : canEditPhotos ? 'Subir foto real' : 'Ver ficha'}
                    className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/95 hover:bg-white border border-slate-200 text-slate-700 text-xs font-medium shadow-sm transition-colors whitespace-nowrap"
                  >
                    {p.image_url ? (
                      <>
                        <Eye className="w-3.5 h-3.5 text-slate-600" />
                        <span>Ver foto</span>
                      </>
                    ) : canEditPhotos ? (
                      <>
                        <Camera className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Subir foto</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>Ficha</span>
                      </>
                    )}
                  </button>

                  {/* Máximo 1 insignia discreta por tarjeta */}
                  {p.featured && (
                    <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/90 text-white text-[11px] font-semibold">
                      <Sparkles className="w-3 h-3 text-emerald-400" />
                      Destacado
                    </span>
                  )}
                </div>

                {/* Cuerpo de tarjeta */}
                <div className="p-3.5 flex-1 flex flex-col">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-500 tabular-nums">
                    <span className="truncate">{catLabel}</span>
                    {p.sku && <span className="font-mono text-[11px] text-slate-400 shrink-0">{p.sku}</span>}
                  </div>

                  <h3 className="mt-1 text-sm font-semibold text-slate-900 leading-snug line-clamp-2">
                    {p.name}
                  </h3>

                  {p.description && (
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2 leading-relaxed">
                      {p.description}
                    </p>
                  )}

                  {Array.isArray(p.variants) && p.variants.length > 0 && (
                    <p className="mt-1.5 text-[11px] text-slate-500 truncate">
                      {p.variant_group_label || 'Presentaciones'}:{' '}
                      <span className="font-medium text-slate-700">
                        {p.variants.map(v => v.label).join(' · ')}
                      </span>
                    </p>
                  )}

                  {showStockInCatalog && (
                    <div className="mt-2 text-xs tabular-nums">
                      {outOfStock ? (
                        <span className="text-amber-700 font-medium">Bajo pedido (0 {p.unit || 'und'})</span>
                      ) : (
                        <span className="text-slate-500">
                          Disponible: <strong className="text-slate-700">{p.stock}</strong> {p.unit || 'und'}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Bloque de precios tabulares */}
                  {priceMode !== 'oculto' && (
                    <div className="mt-auto pt-3 border-t border-slate-100 tabular-nums">
                      {priceMode === 'detal' && (
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-slate-500">Precio</span>
                            <span className="text-base font-bold text-slate-900">{retailFmt.primary}</span>
                          </div>
                          {retailFmt.secondary && (
                            <div className="text-right text-xs font-medium text-slate-500">
                              {retailFmt.secondary}
                            </div>
                          )}
                        </div>
                      )}

                      {priceMode === 'mayor' && (
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-slate-500">
                              {hasMayor
                                ? `Mayor${p.wholesale_min_qty ? ` (≥${p.wholesale_min_qty})` : ''}`
                                : 'Precio'}
                            </span>
                            <span className="text-base font-bold text-emerald-700">
                              {(mayorFmt || retailFmt).primary}
                            </span>
                          </div>
                          {(mayorFmt || retailFmt).secondary && (
                            <div className="text-right text-xs font-medium text-slate-500">
                              {(mayorFmt || retailFmt).secondary}
                            </div>
                          )}
                        </div>
                      )}

                      {priceMode === 'ambos' && (
                        <div className="space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xs text-slate-500">Detal</span>
                            <span className="text-sm font-bold text-slate-900">{retailFmt.primary}</span>
                          </div>
                          {mayorFmt && (
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-xs text-emerald-700 font-medium">
                                Mayor{p.wholesale_min_qty ? ` ≥${p.wholesale_min_qty}` : ''}
                              </span>
                              <span className="text-sm font-bold text-emerald-700">{mayorFmt.primary}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Acciones rápidas para el vendedor: sumar a propuesta/pedido */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    {inDraftQty > 0 ? (
                      <div className="flex items-center justify-between w-full bg-slate-900 text-white rounded-lg px-2 py-1 tabular-nums">
                        <button
                          type="button"
                          onClick={() => addDraftItem(p.id, -1)}
                          className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/15"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-xs font-semibold">
                          {inDraftQty} en propuesta
                        </span>
                        <button
                          type="button"
                          onClick={() => addDraftItem(p.id, 1)}
                          className="w-6 h-6 rounded flex items-center justify-center hover:bg-white/15"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => addDraftItem(p.id, 1)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar a propuesta
                      </button>
                    )}
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        /* Vista Lista Ejecutiva con foto miniatura */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-3 px-3 w-10">Sel.</th>
                  <th className="py-3 px-3">Producto</th>
                  <th className="py-3 px-3">Categoría</th>
                  {showStockInCatalog && <th className="py-3 px-3 text-right">Disponible</th>}
                  {priceMode !== 'oculto' && <th className="py-3 px-3 text-right">Precio</th>}
                  <th className="py-3 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map(p => {
                  const isSelected = selectedIds.has(p.id)
                  const inDraftQty = draftQtyByProduct.get(p.id) || 0
                  const retailFmt = formatCatalogPrice(Number(p.price) || 0)
                  const mayorFmt =
                    Number(p.price_wholesale) > 0
                      ? formatCatalogPrice(Number(p.price_wholesale) || 0)
                      : null

                  return (
                    <tr key={p.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => toggleSelectProduct(p.id)}
                          className={`w-6 h-6 rounded flex items-center justify-center border ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : 'border-slate-300 text-transparent hover:border-slate-400'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => setLightboxProductId(p.id)}
                            className="shrink-0 focus:outline-none"
                            title="Ver foto real"
                          >
                            <ProductThumb src={p.image_url} name={p.name} size="md" fit="contain" />
                          </button>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                            <div className="text-xs text-slate-500 flex items-center gap-2">
                              {p.sku && <span className="font-mono">{p.sku}</span>}
                              {p.description && <span className="truncate max-w-xs">{p.description}</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-600">
                        {(p.category_id && categoryMap.get(p.category_id)) || 'General'}
                      </td>
                      {showStockInCatalog && (
                        <td className="py-2.5 px-3 text-right tabular-nums text-xs">
                          <span className={Number(p.stock) > 0 ? 'text-slate-700 font-medium' : 'text-amber-700'}>
                            {p.stock} {p.unit || 'und'}
                          </span>
                        </td>
                      )}
                      {priceMode !== 'oculto' && (
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {priceMode === 'mayor' ? (
                            <div className="font-bold text-emerald-700">
                              {(mayorFmt || retailFmt).primary}
                            </div>
                          ) : priceMode === 'ambos' ? (
                            <div>
                              <div className="font-bold text-slate-900">{retailFmt.primary}</div>
                              {mayorFmt && (
                                <div className="text-xs text-emerald-700 font-semibold">
                                  Mayor: {mayorFmt.primary}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div className="font-bold text-slate-900">{retailFmt.primary}</div>
                              {retailFmt.secondary && (
                                <div className="text-xs text-slate-500">{retailFmt.secondary}</div>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setLightboxProductId(p.id)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-white"
                            title="Ver foto real"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => addDraftItem(p.id, 1)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium whitespace-nowrap tabular-nums"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            {inDraftQty > 0 ? `(${inDraftQty})` : 'Propuesta'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Barra Flotante de Propuesta / Pedido Rápido */}
      {draftItems.length > 0 && (
        <div className="fixed bottom-4 left-4 right-4 lg:left-72 z-30 pointer-events-none flex justify-center">
          <div className="pointer-events-auto w-full max-w-3xl bg-slate-900 text-white rounded-xl shadow-xl border border-slate-700 px-4 py-3 flex flex-wrap items-center justify-between gap-3 tabular-nums">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold">
                  Propuesta activa: {draftItems.length} {draftItems.length === 1 ? 'producto' : 'productos'} ({totalDraftUnits} und)
                </div>
                <div className="text-xs text-slate-300">
                  Total estimado: <strong className="text-white">{moneyBase(proposalTax.total)}</strong>
                  {hasValidFx && ` · ${formatMoney(convertToFx(proposalTax.total), fxCode)}`}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDraftItems([])}
                className="px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white hover:bg-white/10"
              >
                Vaciar
              </button>
              <button
                type="button"
                onClick={() => setShowProposalDrawer(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors whitespace-nowrap"
              >
                Revisar / Cotizar / Pasar a POS
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visor de Fotografía Real */}
      <ProductPhotoLightbox
        product={lightboxProduct}
        onClose={() => setLightboxProductId(null)}
        onAddToSale={
          lightboxProductId
            ? () => {
                addDraftItem(lightboxProductId, 1)
                notify('Producto agregado a la propuesta activa.')
              }
            : undefined
        }
        addLabel="Agregar a propuesta"
        canEditPhoto={canEditPhotos}
        companyId={companyId}
        onPhotoUpdated={
          lightboxProductId
            ? url => handleUpdateProductPhoto(lightboxProductId, url)
            : undefined
        }
      />

      <CatalogBrandModal
        open={brandModalOpen}
        initialTab={brandModalInitialTab}
        onClose={() => setBrandModalOpen(false)}
        onSaved={() => void loadCatalogData()}
      />

      <SqlActivationModal
        open={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        initialBundle="images"
      />

      {/* Modal Multiempresa de Envío Comercial por WhatsApp + Enlace con Identidad Propia */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 truncate">
                  Centro de Mensajes WhatsApp · {companyName}
                </h2>
                <p className="text-xs text-slate-500 truncate">
                  Envía tu enlace propio con el logo de {companyName}, catálogo curado, propuesta B2B o cuentas de cobro
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWhatsAppModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* Selector de escenario de mensaje */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700">
                    Tipo de mensaje personalizado
                  </span>
                  {(canManageSettings(user?.role) || canManageInventory(user?.role)) && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowWhatsAppModal(false)
                        setBrandModalInitialTab('whatsapp')
                        setBrandModalOpen(true)
                      }}
                      className="text-xs font-medium text-emerald-700 hover:underline whitespace-nowrap"
                    >
                      Editar alias y plantillas de empresa
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {WHATSAPP_SCENARIOS.filter(
                    s =>
                      s.id === 'store_invite' ||
                      s.id === 'catalog_selection' ||
                      s.id === 'wholesale_b2b' ||
                      s.id === 'quick_payment_info'
                  ).map(sc => {
                    const active = waScenario === sc.id
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => handleChangeWaScenario(sc.id)}
                        className={`px-2.5 py-2 rounded-lg border text-xs font-semibold transition-colors whitespace-nowrap ${
                          active
                            ? 'border-slate-900 bg-slate-900 text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {sc.shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Vista previa real de la tarjeta OpenGraph de la empresa en WhatsApp */}
              <div className="rounded-xl border border-emerald-200 bg-[#e7f8ee] p-3 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-emerald-900">
                  <span>Tarjeta automática del enlace de tu tienda en WhatsApp</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleForceRefreshWhatsAppCache}
                      title="Si WhatsApp muestra el nombre o logo viejo, genera un enlace nuevo sin caché"
                      className="inline-flex items-center gap-1 text-emerald-800 hover:text-emerald-950 font-bold hover:underline whitespace-nowrap text-[11px]"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Refrescar caché WhatsApp
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyLink()}
                      className="inline-flex items-center gap-1 text-emerald-800 hover:underline whitespace-nowrap"
                    >
                      <Copy className="w-3 h-3" />
                      Copiar solo link
                    </button>
                  </div>
                </div>
                <div className="rounded-lg bg-white border border-emerald-200/80 p-2.5 flex items-center gap-3">
                  {config?.logo_url ? (
                    <img
                      src={config.logo_url}
                      alt={companyName}
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-lg object-contain border border-slate-200 bg-white p-1 shrink-0"
                    />
                  ) : (
                    <div
                      className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${activeBrandTheme.primaryBtn}`}
                    >
                      {companyName.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {storeCardPreview.title}
                    </p>
                    <p className="text-[11px] text-slate-600 line-clamp-1">
                      {storeCardPreview.description}
                    </p>
                    <p className="text-[10px] font-mono text-slate-400 truncate">
                      {storeCardPreview.displayHost}
                    </p>
                  </div>
                </div>
              </div>

              {/* Flujo recomendado en 2 pasos para adjuntar PDF en WhatsApp */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-slate-600">
                  <strong className="text-slate-900 block mb-0.5">
                    ¿Deseas adjuntar también el catálogo PDF con fotos?
                  </strong>
                  Descárgalo en un clic para enviarlo junto al mensaje en el chat.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Guardar PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleShareInteractiveHtmlFile()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 text-xs font-semibold whitespace-nowrap"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    Ficha archivo
                  </button>
                </div>
              </div>

              {/* Selector de cliente registrado */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cliente registrado (opcional)
                  </label>
                  <input
                    type="text"
                    value={waSearchCustomer}
                    onChange={e => setWaSearchCustomer(e.target.value)}
                    placeholder="Filtrar cliente..."
                    className="w-full px-3 py-1.5 mb-1.5 rounded-lg border border-slate-200 text-xs"
                  />
                  <select
                    value={waCustomerId}
                    onChange={e => handleSelectWaCustomer(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">General (elegir contacto en WhatsApp)</option>
                    {filteredWaCustomers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `· ${c.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Teléfono WhatsApp destino (con código país)
                  </label>
                  <input
                    type="tel"
                    value={waCustomPhone}
                    onChange={e => setWaCustomPhone(e.target.value)}
                    placeholder="Ej: 584121234567 o dejar vacío"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Si lo dejas vacío, WhatsApp te permitirá elegir cualquier chat o grupo.
                  </p>
                </div>
              </div>

              {/* Mensaje editable */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700">
                    Mensaje comercial a enviar
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const cust = customers.find(c => c.id === waCustomerId)
                      setWaCustomText(buildCommercialShareMessage(cust?.name, waScenario))
                    }}
                    className="text-xs text-emerald-700 hover:underline font-medium"
                  >
                    Regenerar desde plantilla
                  </button>
                </div>
                <textarea
                  rows={7}
                  value={waCustomText}
                  onChange={e => setWaCustomText(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800 font-mono leading-relaxed"
                />
              </div>

              {/* Separación limpia: Enlace oficial de invitación a la App InventarioPro */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-slate-600">
                  <strong className="text-slate-800">¿Deseas recomendar la plataforma InventarioPro?</strong>{' '}
                  El enlace raíz conserva el logo e invitación oficial del sistema.
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyToClipboard(platformInviteUrl)
                      notify(
                        ok
                          ? 'Enlace oficial de invitación a InventarioPro copiado.'
                          : 'No se pudo copiar el enlace.',
                        ok ? 'ok' : 'err'
                      )
                    }}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium whitespace-nowrap"
                  >
                    Copiar link App
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setWaCustomText(
                        buildPlatformInviteWhatsAppMessage({
                          origin: window.location.origin,
                          inviterName: advisorName,
                          inviterCompany: companyName,
                        })
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium whitespace-nowrap"
                  >
                    Usar invitación App
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyToClipboard(waCustomText)
                  notify(ok ? 'Mensaje copiado al portapapeles.' : 'No se pudo copiar.', ok ? 'ok' : 'err')
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700"
              >
                <Copy className="w-3.5 h-3.5" />
                Copiar mensaje
              </button>

              <a
                href={whatsAppHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setShowWhatsAppModal(false)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold whitespace-nowrap"
              >
                <MessageCircle className="w-4 h-4" />
                Abrir WhatsApp y enviar
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Código QR del Catálogo Digital */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-sm w-full p-5 text-center shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-slate-900">Código QR de {companyName}</h2>
              <button
                type="button"
                onClick={() => setShowQrModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Tu cliente escanea este código o abre tu enlace propio con la identidad y logo de {companyName}.
            </p>
            {catalogQrMarkup ? (
              <div
                className="w-52 h-52 mx-auto p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-center [&_svg]:w-full [&_svg]:h-full"
                dangerouslySetInnerHTML={{ __html: catalogQrMarkup }}
              />
            ) : (
              <div className="py-8 text-xs text-slate-400">QR no disponible</div>
            )}
            <div className="mt-4 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 break-all font-mono">
              {publicCatalogUrl}
            </div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopyLink()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-700"
              >
                <Copy className="w-3.5 h-3.5" />
                Copiar enlace
              </button>
              {companyId && onPreviewCatalog && (
                <button
                  type="button"
                  onClick={() => {
                    setShowQrModal(false)
                    onPreviewCatalog(config?.catalog_slug || companyId)
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Abrir vitrina
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drawer de Propuesta Comercial / Cotización / Pase directo a POS */}
      {showProposalDrawer && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full flex flex-col shadow-2xl border-l border-slate-200">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Propuesta Comercial desde Catálogo
                </h2>
                <p className="text-xs text-slate-500">
                  Convierte esta selección en venta rápida en Mostrador (POS) o en Cotización formal PDF / WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowProposalDrawer(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cliente
                  </label>
                  <select
                    value={proposalCustomerId}
                    onChange={e => setProposalCustomerId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Cliente general</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.price_type === 'mayor' ? '(Mayorista)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Descuento %
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={proposalDiscountPct}
                    onChange={e => setProposalDiscountPct(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>
              </div>

              {/* Líneas del pedido */}
              <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
                {proposalLines.map(line => (
                  <div key={line.product_id} className="p-3 flex items-center gap-3">
                    <ProductThumb
                      src={line.product.image_url}
                      name={line.product_name}
                      size="sm"
                      fit="contain"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-900 truncate">
                        {line.product_name}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {moneyBase(line.price)} c/u {line.mayor && '· Tarifa mayor'}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 tabular-nums">
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={e => setDraftItemQty(line.product_id, parseInt(e.target.value) || 1)}
                        className="w-16 px-2 py-1 rounded border border-slate-300 text-right text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setDraftItemQty(line.product_id, 0)}
                        className="p-1.5 text-slate-400 hover:text-red-600"
                        title="Quitar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Totales */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1.5 text-sm tabular-nums">
                <div className="flex justify-between text-slate-600">
                  <span>Subtotal</span>
                  <span>{moneyBase(proposalTax.subtotal)}</span>
                </div>
                {proposalTax.tax > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Impuesto ({proposalTax.rate}%)</span>
                    <span>{moneyBase(proposalTax.tax)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                  <span>Total</span>
                  <span>{moneyBase(proposalTax.total)}</span>
                </div>
                {hasValidFx && (
                  <div className="flex justify-between text-xs font-semibold text-emerald-700">
                    <span>Equivalente en {fxCode}</span>
                    <span>{formatMoney(convertToFx(proposalTax.total), fxCode)}</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-600">Validez cotización (días):</label>
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={proposalValidDays}
                  onChange={e => setProposalValidDays(e.target.value)}
                  className="w-20 px-2.5 py-1 rounded-lg border border-slate-300 text-xs tabular-nums"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {canSell && (
                  <button
                    type="button"
                    onClick={handleSendDraftToPos}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    <Store className="w-4 h-4" />
                    Cargar en Mostrador (POS)
                  </button>
                )}

                {canSell && (
                  <button
                    type="button"
                    disabled={savingQuotation}
                    onClick={() => void handleSaveFormalQuotation(true)}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap"
                  >
                    <FileText className="w-4 h-4" />
                    {savingQuotation ? 'Guardando...' : 'Guardar Cotización + PDF'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => printHtml(buildDocHtml(buildProposalDoc(), config))}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Solo imprimir PDF
                </button>

                <a
                  href={`https://wa.me/${cleanPhoneForWhatsApp(proposalCustomer?.phone)}?text=${encodeURIComponent(
                    buildShareText(buildProposalDoc(), config)
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold text-emerald-800 whitespace-nowrap"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  Propuesta por WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
