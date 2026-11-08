import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useBackOverlay } from '../lib/navigation'
import { copyToClipboard } from '../lib/copilotShare'
import {
  BRAND_THEME_LIST,
  DELIVERY_MODE_LABELS,
  normalizeCatalogPaymentMethods,
  normalizeDeliveryModes,
  resolveBrandTheme,
  uploadCatalogAssetOrInline,
} from '../lib/catalogCommerce'
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  WHATSAPP_SCENARIOS,
  buildCompanyStoreUrl,
  buildPlatformInviteUrl,
  buildStorePreviewCardSummary,
  normalizeWhatsAppSettings,
  renderCompanyWhatsAppMessage,
  slugifyStoreAlias,
} from '../lib/whatsappStudio'
import type {
  BrandThemeId,
  CatalogDeliveryMode,
  CatalogPaymentMethodConfig,
  CompanyConfig,
  CompanyWhatsAppSettings,
  WhatsAppTemplateScenario,
} from '../types'
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  Globe,
  ImagePlus,
  MessageCircle,
  Palette,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Truck,
  X,
} from 'lucide-react'

export type CatalogBrandModalTab = 'brand' | 'whatsapp' | 'payments'

interface CatalogBrandModalProps {
  open: boolean
  onClose: () => void
  onSaved?: (updated: Partial<CompanyConfig>) => void
  initialTab?: CatalogBrandModalTab
}

export default function CatalogBrandModal({
  open,
  onClose,
  onSaved,
  initialTab = 'brand',
}: CatalogBrandModalProps) {
  const [tab, setTab] = useState<CatalogBrandModalTab>(initialTab)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null)
  const [copiedStoreLink, setCopiedStoreLink] = useState(false)
  const [copiedAppInvite, setCopiedAppInvite] = useState(false)

  const [configId, setConfigId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [companyName, setCompanyName] = useState('Mi Empresa')
  const [rif, setRif] = useState('')
  const [companyPhone, setCompanyPhone] = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [brandTheme, setBrandTheme] = useState<BrandThemeId>('emerald')
  const [catalogEnabled, setCatalogEnabled] = useState(true)
  const [showWholesale, setShowWholesale] = useState(true)
  const [showStock, setShowStock] = useState(true)
  const [welcome, setWelcome] = useState('')
  const [deliveryModes, setDeliveryModes] = useState<CatalogDeliveryMode[]>(['pickup', 'delivery'])
  const [paymentMethods, setPaymentMethods] = useState<CatalogPaymentMethodConfig[]>([])

  // Enlace propio /tienda/<alias> y Estudio Multiempresa de WhatsApp
  const [catalogSlug, setCatalogSlug] = useState('')
  const [businessWhatsapp, setBusinessWhatsapp] = useState('')
  const [advisorTitle, setAdvisorTitle] = useState('Asesor Comercial')
  const [brandTagline, setBrandTagline] = useState('')
  const [ogCardSubtitle, setOgCardSubtitle] = useState('')
  const [businessHours, setBusinessHours] = useState('')
  const [includeRifInMessages, setIncludeRifInMessages] = useState(true)
  const [includeHoursInMessages, setIncludeHoursInMessages] = useState(true)
  const [includePaymentSummary, setIncludePaymentSummary] = useState(false)
  const [templates, setTemplates] = useState<Record<WhatsAppTemplateScenario, string>>({
    ...DEFAULT_WHATSAPP_TEMPLATES,
  })
  const [activeScenario, setActiveScenario] = useState<WhatsAppTemplateScenario>('store_invite')

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const templateTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  useBackOverlay(open && !saving, onClose)

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    void loadCurrentConfig()
  }, [open, initialTab])

  async function loadCurrentConfig() {
    setLoading(true)
    setFeedback(null)
    const { data } = await supabase.from('company_config').select('*').limit(1).maybeSingle()
    const cfg = (data || {}) as Partial<CompanyConfig>
    const cName = cfg.name || 'Mi Empresa'
    const cRif = cfg.rif || ''
    const cPhone = cfg.phone || ''
    const cEmail = cfg.email || ''

    setConfigId(cfg.id || '')
    setCompanyId(cfg.company_id || cfg.id || '')
    setCompanyName(cName)
    setRif(cRif)
    setCompanyPhone(cPhone)
    setCompanyEmail(cEmail)
    setLogoUrl(cfg.logo_url || null)
    setBrandTheme((cfg.brand_theme as BrandThemeId) || 'emerald')
    setCatalogEnabled(cfg.catalog_enabled !== false)
    setShowWholesale(cfg.catalog_show_wholesale !== false)
    setShowStock(cfg.catalog_show_stock !== false)
    setWelcome(cfg.catalog_welcome || '')
    setDeliveryModes(normalizeDeliveryModes(cfg.catalog_delivery_modes))
    setPaymentMethods(
      normalizeCatalogPaymentMethods(cfg.catalog_payment_methods, {
        companyName: cName,
        rif: cRif,
        phone: cPhone,
        email: cEmail,
      })
    )

    const initialSlug = cfg.catalog_slug
      ? slugifyStoreAlias(cfg.catalog_slug)
      : slugifyStoreAlias(cName)
    setCatalogSlug(initialSlug)

    const wa = normalizeWhatsAppSettings(cfg.whatsapp_settings, {
      companyName: cName,
      phone: cPhone,
      welcome: cfg.catalog_welcome,
    })
    setBusinessWhatsapp(wa.business_whatsapp)
    setAdvisorTitle(wa.advisor_title)
    setBrandTagline(wa.brand_tagline)
    setOgCardSubtitle(wa.og_card_subtitle)
    setBusinessHours(wa.business_hours)
    setIncludeRifInMessages(wa.include_rif_in_messages)
    setIncludeHoursInMessages(wa.include_hours_in_messages)
    setIncludePaymentSummary(wa.include_payment_summary_in_messages)
    setTemplates(wa.templates)

    setLoading(false)
  }

  async function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingLogo(true)
    setFeedback(null)
    try {
      const savedUrl = await uploadCatalogAssetOrInline(file, 'logo', companyId || 'empresa')
      setLogoUrl(savedUrl)
    } catch (err) {
      setFeedback({
        text: err instanceof Error ? err.message : 'No se pudo procesar el logo.',
        tone: 'err',
      })
    } finally {
      setUploadingLogo(false)
    }
  }

  function toggleDeliveryMode(mode: CatalogDeliveryMode) {
    setDeliveryModes(prev => {
      if (prev.includes(mode)) {
        if (prev.length === 1) return prev
        return prev.filter(m => m !== mode)
      }
      return [...prev, mode]
    })
  }

  function updatePaymentMethod(
    index: number,
    patch: Partial<CatalogPaymentMethodConfig>
  ) {
    setPaymentMethods(prev =>
      prev.map((m, idx) => (idx === index ? { ...m, ...patch } : m))
    )
  }

  function insertVariableIntoTemplate(token: string) {
    const el = templateTextareaRef.current
    const current = templates[activeScenario] || ''
    if (!el) {
      setTemplates(prev => ({
        ...prev,
        [activeScenario]: current ? `${current} ${token}` : token,
      }))
      return
    }
    const start = el.selectionStart ?? current.length
    const end = el.selectionEnd ?? current.length
    const next = current.slice(0, start) + token + current.slice(end)
    setTemplates(prev => ({ ...prev, [activeScenario]: next }))
    window.requestAnimationFrame(() => {
      el.focus()
      const pos = start + token.length
      el.setSelectionRange(pos, pos)
    })
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const normalizedSlugPreview = slugifyStoreAlias(catalogSlug) || slugifyStoreAlias(companyName)

  const liveWhatsappSettings = useMemo<CompanyWhatsAppSettings>(
    () => ({
      business_whatsapp: businessWhatsapp.trim(),
      advisor_title: advisorTitle.trim() || 'Asesor Comercial',
      brand_tagline: brandTagline.trim(),
      og_card_subtitle: ogCardSubtitle.trim(),
      business_hours: businessHours.trim(),
      include_rif_in_messages: includeRifInMessages,
      include_hours_in_messages: includeHoursInMessages,
      include_payment_summary_in_messages: includePaymentSummary,
      templates,
    }),
    [
      businessWhatsapp,
      advisorTitle,
      brandTagline,
      ogCardSubtitle,
      businessHours,
      includeRifInMessages,
      includeHoursInMessages,
      includePaymentSummary,
      templates,
    ]
  )

  const storeUrlPreview = useMemo(
    () =>
      buildCompanyStoreUrl(origin, companyId, normalizedSlugPreview || null, {
        name: companyName,
        logo_url: logoUrl,
        brand_theme: brandTheme,
        catalog_welcome: welcome,
        whatsapp_settings: liveWhatsappSettings,
      }),
    [origin, companyId, normalizedSlugPreview, companyName, logoUrl, brandTheme, welcome, liveWhatsappSettings]
  )
  const platformInviteUrl = useMemo(() => buildPlatformInviteUrl(origin), [origin])

  const ogCardPreview = useMemo(
    () =>
      buildStorePreviewCardSummary({
        companyName,
        rif,
        welcome,
        whatsappSettings: liveWhatsappSettings,
        storeUrl: storeUrlPreview,
      }),
    [companyName, rif, welcome, liveWhatsappSettings, storeUrlPreview]
  )

  const liveTemplateSampleText = useMemo(() => {
    const draftCfg: Partial<CompanyConfig> = {
      name: companyName,
      rif,
      phone: companyPhone,
      email: companyEmail,
      catalog_welcome: welcome || null,
      catalog_payment_methods: paymentMethods,
      whatsapp_settings: liveWhatsappSettings,
    }
    return renderCompanyWhatsAppMessage(activeScenario, {
      config: draftCfg,
      companyName,
      storeUrl: storeUrlPreview,
      customerName: 'Comercial Santa Fe',
      advisorName: advisorTitle.trim() || 'Asesor Comercial',
      advisorPhone: businessWhatsapp || companyPhone,
      catalogTitle: `Catálogo Comercial · ${companyName}`,
      productLinesText: [
        '• Producto Destacado A [SKU-101] — *$12.50* · Presentaciones: 500ml, 1 Litro',
        '• Producto Mayorista B [SKU-204] — *$8.90* · Presentaciones: Talla S, M, L',
      ].join('\n'),
      commercialNote: 'Despacho inmediato al corroborar comprobante de pago.',
      orderNumber: 'WEB-1042',
      trackingPin: '4821',
      orderTotalFormatted: '$148.00',
      paymentReference: '89304122',
      deliveryStatusLabel: 'Despachado en ruta',
      adminNote: 'Tu pedido salió con nuestra unidad de reparto asignada.',
    })
  }, [
    activeScenario,
    companyName,
    rif,
    companyPhone,
    companyEmail,
    welcome,
    paymentMethods,
    liveWhatsappSettings,
    storeUrlPreview,
    advisorTitle,
    businessWhatsapp,
  ])

  async function handleCopyStorePreviewLink() {
    const ok = await copyToClipboard(storeUrlPreview)
    if (ok) {
      setCopiedStoreLink(true)
      window.setTimeout(() => setCopiedStoreLink(false), 2400)
    }
  }

  async function handleCopyPlatformLink() {
    const ok = await copyToClipboard(platformInviteUrl)
    if (ok) {
      setCopiedAppInvite(true)
      window.setTimeout(() => setCopiedAppInvite(false), 2400)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setFeedback(null)

    const cleanWelcome = welcome.trim() || null
    const cleanSlug = normalizedSlugPreview || null
    const whatsappPayload: CompanyWhatsAppSettings = {
      business_whatsapp: businessWhatsapp.trim(),
      advisor_title: advisorTitle.trim() || 'Asesor Comercial',
      brand_tagline: brandTagline.trim(),
      og_card_subtitle: ogCardSubtitle.trim(),
      business_hours: businessHours.trim(),
      include_rif_in_messages: includeRifInMessages,
      include_hours_in_messages: includeHoursInMessages,
      include_payment_summary_in_messages: includePaymentSummary,
      templates,
    }

    const rpcRes = await supabase.rpc('guardar_identidad_catalogo', {
      p_enabled: catalogEnabled,
      p_show_wholesale: showWholesale,
      p_show_stock: showStock,
      p_welcome: cleanWelcome,
      p_logo_url: logoUrl,
      p_brand_theme: brandTheme,
      p_payment_methods: paymentMethods,
      p_delivery_modes: deliveryModes,
      p_catalog_slug: cleanSlug,
      p_whatsapp_settings: whatsappPayload,
    })

    if (rpcRes.error) {
      const errMsg = rpcRes.error.message || ''
      if (/alias|ocupado|unique|idx_company_config_catalog_slug_unique/i.test(errMsg)) {
        setSaving(false)
        setFeedback({
          text: `El alias «${cleanSlug}» ya está asignado a otra empresa en InventarioPro. Elige un alias distinto.`,
          tone: 'err',
        })
        return
      }

      // Fallback directo sobre company_config si la función de 10 parámetros aún no se aplicó
      if (configId) {
        const upd = await supabase
          .from('company_config')
          .update({
            catalog_enabled: catalogEnabled,
            catalog_show_wholesale: showWholesale,
            catalog_show_stock: showStock,
            catalog_welcome: cleanWelcome,
            logo_url: logoUrl,
            brand_theme: brandTheme,
            catalog_payment_methods: paymentMethods,
            catalog_delivery_modes: deliveryModes,
            catalog_slug: cleanSlug,
            whatsapp_settings: whatsappPayload,
            brand_version: Math.random().toString(36).slice(2, 8),
          })
          .eq('id', configId)

        if (upd.error) {
          if (/idx_company_config_catalog_slug_unique|duplicate key/i.test(upd.error.message || '')) {
            setSaving(false)
            setFeedback({
              text: `El alias «${cleanSlug}» ya está en uso por otra empresa. Prueba agregando tu ciudad o siglas.`,
              tone: 'err',
            })
            return
          }

          // Intentar RPC previa de 8 parámetros o ajustes base
          const legacyRpc = await supabase.rpc('guardar_identidad_catalogo', {
            p_enabled: catalogEnabled,
            p_show_wholesale: showWholesale,
            p_show_stock: showStock,
            p_welcome: cleanWelcome,
            p_logo_url: logoUrl,
            p_brand_theme: brandTheme,
            p_payment_methods: paymentMethods,
            p_delivery_modes: deliveryModes,
          })

          if (legacyRpc.error) {
            await supabase.rpc('guardar_ajustes_catalogo', {
              p_enabled: catalogEnabled,
              p_show_wholesale: showWholesale,
              p_show_stock: showStock,
              p_welcome: cleanWelcome,
            })
          }

          setSaving(false)
          setFeedback({
            text: 'Ejecuta el paquete SQL actualizado en Administración → Scripts SQL y Supabase para activar el alias propio /tienda/... y las plantillas de WhatsApp en la nube.',
            tone: 'err',
          })
          return
        }
      }
    }

    const savedData = (rpcRes.data || {}) as { catalog_slug?: string | null }
    const finalSlug = savedData.catalog_slug !== undefined ? savedData.catalog_slug : cleanSlug
    if (finalSlug) setCatalogSlug(finalSlug)

    setSaving(false)
    setFeedback({
      text: 'Identidad corporativa, enlace propio de tienda y plantillas de WhatsApp guardados.',
      tone: 'ok',
    })
    onSaved?.({
      logo_url: logoUrl,
      brand_theme: brandTheme,
      catalog_enabled: catalogEnabled,
      catalog_show_wholesale: showWholesale,
      catalog_show_stock: showStock,
      catalog_welcome: cleanWelcome,
      catalog_slug: finalSlug,
      catalog_payment_methods: paymentMethods,
      catalog_delivery_modes: deliveryModes,
      whatsapp_settings: whatsappPayload,
    })
  }

  if (!open) return null

  const activeTheme = resolveBrandTheme(brandTheme)
  const currentScenarioMeta =
    WHATSAPP_SCENARIOS.find(s => s.id === activeScenario) || WHATSAPP_SCENARIOS[0]

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white rounded-xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 truncate">
              Identidad Corporativa, Enlace Propio y Estudio de WhatsApp
            </h2>
            <p className="text-xs text-slate-500 truncate">
              Configura el logo de {companyName}, su enlace /tienda/... con tarjeta propia en WhatsApp y sus canales de cobro
            </p>
          </div>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 pt-3 border-b border-slate-100 flex items-center gap-1 bg-slate-50/70 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('brand')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'brand'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            Logo, Color e Identidad
          </button>

          <button
            type="button"
            onClick={() => setTab('whatsapp')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'whatsapp'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5" />
            Enlace Propio y WhatsApp
          </button>

          <button
            type="button"
            onClick={() => setTab('payments')}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'payments'
                ? 'border-slate-900 text-slate-900 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            Pago Móvil, Nequi, Zelle y Bancos
          </button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-slate-400">
            Cargando configuración corporativa...
          </div>
        ) : (
          <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-5">
            {tab === 'brand' && (
              <>
                {/* Vista previa viva del encabezado de la tienda */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-white border-b border-slate-200 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {logoUrl ? (
                        <img
                          src={logoUrl}
                          alt={companyName}
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-lg object-contain border border-slate-200 bg-white p-0.5 shrink-0"
                        />
                      ) : (
                        <div
                          className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${activeTheme.primaryBtn}`}
                        >
                          {companyName.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {companyName}
                      </span>
                    </div>
                    <span
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${activeTheme.primaryBtn}`}
                    >
                      Carrito (3)
                    </span>
                  </div>
                  <div className={`px-4 py-4 ${activeTheme.heroBanner}`}>
                    <p className="text-xs opacity-80">
                      Vista previa en vivo · {activeTheme.label}
                    </p>
                    <p className="text-sm font-bold mt-0.5">
                      {welcome.trim() || `Catálogo comercial de ${companyName}`}
                    </p>
                  </div>
                </div>

                {/* Carga de Logo de la Empresa */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-slate-500" />
                      <h3 className="text-xs font-bold text-slate-800">
                        Logo oficial de la empresa
                      </h3>
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Se muestra en tu tienda en línea, en la tarjeta de vista previa al compartir el enlace por WhatsApp, en comprobantes y en el catálogo PDF.
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={e => void handleLogoFile(e)}
                      className="hidden"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={uploadingLogo}
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        {uploadingLogo ? 'Procesando...' : logoUrl ? 'Cambiar logo' : 'Subir logo'}
                      </button>
                      {logoUrl && (
                        <button
                          type="button"
                          onClick={() => setLogoUrl(null)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-red-600 hover:bg-red-50 whitespace-nowrap shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Quitar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Selección de Color Corporativo */}
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <Palette className="w-4 h-4 text-slate-500" />
                      <h3 className="text-xs font-bold text-slate-800">
                        Color de identidad corporativa
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {BRAND_THEME_LIST.map(t => {
                        const selected = brandTheme === t.id
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setBrandTheme(t.id)}
                            className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-xs font-medium transition-colors ${
                              selected
                                ? 'border-slate-900 bg-slate-50 text-slate-900'
                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                            }`}
                          >
                            <span className={`w-4 h-4 rounded shrink-0 ${t.swatchBg}`} />
                            <span className="truncate flex-1">{t.label}</span>
                            {selected && <Check className="w-3.5 h-3.5 text-slate-900 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Mensaje y visibilidad */}
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Título de bienvenida en el catálogo digital
                    </label>
                    <input
                      value={welcome}
                      maxLength={180}
                      onChange={e => setWelcome(e.target.value)}
                      placeholder={`Catálogo oficial de ${companyName} · Ventas al detal y mayor`}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={catalogEnabled}
                        onChange={e => setCatalogEnabled(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span className="text-xs text-slate-700">
                        <strong className="block text-slate-900">Catálogo activo</strong>
                        Recibe pedidos online de clientes.
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showWholesale}
                        onChange={e => setShowWholesale(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span className="text-xs text-slate-700">
                        <strong className="block text-slate-900">Precios al mayor</strong>
                        Aplica descuento automático por volumen.
                      </span>
                    </label>

                    <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showStock}
                        onChange={e => setShowStock(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span className="text-xs text-slate-700">
                        <strong className="block text-slate-900">Mostrar existencias</strong>
                        Muestra unidades disponibles en vivo.
                      </span>
                    </label>
                  </div>
                </div>

                {/* Modalidades de Entrega */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Truck className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-semibold text-slate-800">
                      Modalidades de entrega habilitadas para el comprador
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {(['pickup', 'delivery', 'shipping'] as CatalogDeliveryMode[]).map(mode => {
                      const active = deliveryModes.includes(mode)
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => toggleDeliveryMode(mode)}
                          className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white'
                              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          <span className="truncate">{DELIVERY_MODE_LABELS[mode]}</span>
                          {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            {tab === 'whatsapp' && (
              <div className="space-y-5">
                {/* Bloque 1: Enlace propio /tienda/<alias> vs Enlace original InventarioPro */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Globe className="w-4 h-4 text-emerald-700" />
                        Enlace Propio de Catálogo con Identidad de {companyName}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Este enlace dedicado absorbe automáticamente el <strong>logo, nombre comercial, RIF y descripción de {companyName}</strong> cuando lo envías por WhatsApp, mientras que el enlace raíz sigue presentando a <strong>InventarioPro</strong> para invitar a nuevas empresas.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCatalogSlug(slugifyStoreAlias(companyName))}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                      Sugerir alias
                    </button>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
                    <div className="lg:col-span-5">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Alias personalizado de tu tienda
                      </label>
                      <div className="flex items-center rounded-lg border border-slate-300 bg-white overflow-hidden focus-within:border-slate-800">
                        <span className="px-2.5 py-2 bg-slate-100 text-slate-500 text-xs font-mono border-r border-slate-200 select-none">
                          /tienda/
                        </span>
                        <input
                          value={catalogSlug}
                          onChange={e =>
                            setCatalogSlug(
                              e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9-_]+/g, '-')
                                .replace(/^-+/, '')
                            )
                          }
                          placeholder={slugifyStoreAlias(companyName) || 'mi-empresa'}
                          className="w-full px-2.5 py-2 text-xs font-mono text-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="lg:col-span-7">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Enlace público listo para compartir con clientes
                      </label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-700 truncate">
                          {storeUrlPreview}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCopyStorePreviewLink()}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold whitespace-nowrap shrink-0"
                        >
                          {copiedStoreLink ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                          {copiedStoreLink ? 'Copiado' : 'Copiar link tienda'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Comparativa visual: Tarjeta de la Empresa vs Tarjeta de InventarioPro */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    {/* Tarjeta WhatsApp de la Empresa */}
                    <div className="rounded-xl border border-emerald-200 bg-[#e7f8ee] p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-900">
                        <span>Así ven tus clientes tu enlace /tienda/...</span>
                        <span>Logo de tu empresa</span>
                      </div>
                      <div className="rounded-lg bg-white border border-emerald-200/80 p-2.5 flex items-start gap-3 shadow-sm">
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt={companyName}
                            referrerPolicy="no-referrer"
                            className="w-14 h-14 rounded-lg object-contain border border-slate-200 bg-white p-1 shrink-0"
                          />
                        ) : (
                          <div
                            className={`w-14 h-14 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 ${activeTheme.primaryBtn}`}
                          >
                            {companyName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-xs font-bold text-slate-900 line-clamp-1">
                            {ogCardPreview.title}
                          </p>
                          <p className="text-[11px] text-slate-600 line-clamp-2 leading-snug">
                            {ogCardPreview.description}
                          </p>
                          <p className="text-[10px] font-mono text-slate-400 truncate">
                            {ogCardPreview.displayHost}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Tarjeta original intacta de InventarioPro */}
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
                        <span>Enlace raíz de invitación a la App</span>
                        <button
                          type="button"
                          onClick={() => void handleCopyPlatformLink()}
                          className="inline-flex items-center gap-1 text-emerald-700 hover:underline whitespace-nowrap"
                        >
                          {copiedAppInvite ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedAppInvite ? 'Invitación copiada' : 'Copiar link app'}
                        </button>
                      </div>
                      <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 flex items-start gap-3">
                        <img
                          src="/logo_inventarioPro.png"
                          alt="InventarioPro"
                          className="w-14 h-14 rounded-lg object-contain border border-slate-200 bg-white p-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-xs font-bold text-slate-900 line-clamp-1">
                            InventarioPro — Sistema de Inventario, POS y Gestión Comercial
                          </p>
                          <p className="text-[11px] text-slate-500 line-clamp-2 leading-snug">
                            Conserva intacta la presentación oficial de InventarioPro para invitar otros comercios al software.
                          </p>
                          <p className="text-[10px] font-mono text-slate-400 truncate">
                            {platformInviteUrl}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bloque 2: Datos corporativos que alimentan los mensajes y la tarjeta OG */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5">
                  <h3 className="text-xs font-bold text-slate-800">
                    Datos Corporativos del Servicio Personalizado de WhatsApp
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        WhatsApp oficial receptor de pedidos
                      </label>
                      <input
                        type="tel"
                        value={businessWhatsapp}
                        onChange={e => setBusinessWhatsapp(e.target.value)}
                        placeholder={companyPhone || 'Ej. +58 412-5550140'}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Cargo o firma comercial por defecto
                      </label>
                      <input
                        value={advisorTitle}
                        onChange={e => setAdvisorTitle(e.target.value)}
                        placeholder="Ej. Asesor Comercial / Atención Mayorista"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Eslogan comercial (saludo y título de tarjeta WhatsApp)
                      </label>
                      <input
                        value={brandTagline}
                        maxLength={140}
                        onChange={e => setBrandTagline(e.target.value)}
                        placeholder={`Catálogo oficial de ${companyName} · Atención inmediata`}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Horario de atención al cliente
                      </label>
                      <input
                        value={businessHours}
                        maxLength={100}
                        onChange={e => setBusinessHours(e.target.value)}
                        placeholder="Ej. Lunes a Sábado · 8:00 a.m. a 5:30 p.m."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Descripción corta debajo del título al compartir el link en WhatsApp
                      </label>
                      <input
                        value={ogCardSubtitle}
                        maxLength={180}
                        onChange={e => setOgCardSubtitle(e.target.value)}
                        placeholder="Selecciona productos, tallas o medidas y envía tu comprobante de pago en línea."
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                    <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={includeRifInMessages}
                        onChange={e => setIncludeRifInMessages(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span>Mostrar RIF / NIT en propuestas B2B y datos de pago</span>
                    </label>

                    <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={includeHoursInMessages}
                        onChange={e => setIncludeHoursInMessages(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span>Incluir horario de atención en invitaciones</span>
                    </label>

                    <label className="flex items-start gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50/70 cursor-pointer text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={includePaymentSummary}
                        onChange={e => setIncludePaymentSummary(e.target.checked)}
                        className="mt-0.5 accent-slate-900"
                      />
                      <span>Anexar cuentas de pago activas en mensajes de catálogo</span>
                    </label>
                  </div>
                </div>

                {/* Bloque 3: Estudio de Plantillas Dinámicas por Escenario */}
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">
                        Plantillas Personalizadas de WhatsApp para {companyName}
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Cada empresa en InventarioPro puede adaptar su tono comercial para ventas, cobros y confirmación de pedidos.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setTemplates(prev => ({
                          ...prev,
                          [activeScenario]: DEFAULT_WHATSAPP_TEMPLATES[activeScenario],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50 whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Restaurar base
                    </button>
                  </div>

                  {/* Pestañas de los 6 escenarios */}
                  <div className="flex flex-wrap gap-1.5">
                    {WHATSAPP_SCENARIOS.map(sc => {
                      const active = sc.id === activeScenario
                      return (
                        <button
                          key={sc.id}
                          type="button"
                          onClick={() => setActiveScenario(sc.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                            active
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {sc.shortLabel}
                        </button>
                      )
                    })}
                  </div>

                  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <strong className="text-slate-900">{currentScenarioMeta.label}:</strong>{' '}
                    {currentScenarioMeta.description}
                  </p>

                  {/* Variables dinámicas insertables en 1 clic */}
                  <div className="space-y-1.5">
                    <span className="block text-[11px] font-medium text-slate-500">
                      Variables dinámicas disponibles (clic para insertar en el mensaje):
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {currentScenarioMeta.variables.map(v => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => insertVariableIntoTemplate(v)}
                          className="px-2 py-1 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-[11px] font-mono text-slate-700"
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Editor de plantilla
                      </label>
                      <textarea
                        ref={templateTextareaRef}
                        rows={8}
                        value={templates[activeScenario] || ''}
                        onChange={e =>
                          setTemplates(prev => ({
                            ...prev,
                            [activeScenario]: e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-mono text-slate-800 leading-relaxed"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        Vista previa real en WhatsApp
                      </label>
                      <div className="rounded-lg border border-emerald-200 bg-[#effaf3] p-3 text-xs text-slate-800 whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto">
                        {liveTemplateSampleText}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'payments' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Activa los medios de pago que recibe <strong>{companyName}</strong> ({rif || 'sin RIF configurado'}). Cuando el cliente elija uno en el catálogo, verá tus datos oficiales para transferir en un clic y adjuntará el <strong>capture o pantallazo del recibo</strong> para corroboración administrativa.
                </p>

                <div className="space-y-3">
                  {paymentMethods.map((pm, idx) => (
                    <div
                      key={pm.id}
                      className={`rounded-xl border p-4 space-y-3 transition-colors ${
                        pm.enabled ? 'border-slate-300 bg-white' : 'border-slate-200 bg-slate-50/70 opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pm.enabled}
                            onChange={e => updatePaymentMethod(idx, { enabled: e.target.checked })}
                            className="accent-slate-900"
                          />
                          <span className="text-sm font-bold text-slate-900">{pm.label}</span>
                        </label>
                        <span className="text-xs text-slate-500">
                          {pm.requires_proof ? 'Solicita capture de pago' : 'Sin capture previo'}
                        </span>
                      </div>

                      {pm.enabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Banco o plataforma
                            </label>
                            <input
                              value={pm.bank_or_platform}
                              onChange={e =>
                                updatePaymentMethod(idx, { bank_or_platform: e.target.value })
                              }
                              placeholder="Ej. Banesco (0134), Nequi, Zelle..."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Teléfono, cuenta o correo receptor
                            </label>
                            <input
                              value={pm.account_or_phone}
                              onChange={e =>
                                updatePaymentMethod(idx, { account_or_phone: e.target.value })
                              }
                              placeholder="Ej. 0412-5550140 / pagos@empresa.com"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Titular o razón social
                            </label>
                            <input
                              value={pm.holder_name}
                              onChange={e =>
                                updatePaymentMethod(idx, { holder_name: e.target.value })
                              }
                              placeholder={companyName}
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              RIF / NIT / Cédula del titular
                            </label>
                            <input
                              value={pm.holder_document}
                              onChange={e =>
                                updatePaymentMethod(idx, { holder_document: e.target.value })
                              }
                              placeholder="Ej. J-41289034-7"
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs tabular-nums"
                            />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">
                              Instrucción breve para el comprador
                            </label>
                            <input
                              value={pm.instructions || ''}
                              onChange={e =>
                                updatePaymentMethod(idx, { instructions: e.target.value })
                              }
                              placeholder="Ej. Adjunta capture legible donde se aprecie la referencia."
                              className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {feedback && (
              <div
                className={`rounded-lg border px-3.5 py-2.5 text-xs ${
                  feedback.tone === 'ok'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}
              >
                {feedback.text}
              </div>
            )}

            <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Guardando...' : 'Guardar identidad, enlace y pagos'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
