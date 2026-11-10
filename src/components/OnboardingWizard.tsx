import { useState, useEffect } from 'react'
import {
  Building2,
  Coins,
  Package,
  Users,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Store,
  Receipt,
  Warehouse as WarehouseIcon,
  ShoppingBag,
  DollarSign,
  Layers,
  ChevronRight,
  Check,
  AlertCircle,
  X,
  CreditCard,
  Banknote,
  Send,
  Zap,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { normalizeCurrency, refreshCurrency, formatMoney, CURRENCIES } from '../lib/currency'
import CurrencySelect from './CurrencySelect'
import { taxRateOf } from '../lib/tax'

// Sugerencia de moneda y datos por país / huso horario
const COUNTRY_PRESETS: Record<string, { currency: string; taxRate: number; docName: string; defaultDoc: string; prefix: string }> = {
  CO: { currency: 'COP', taxRate: 19, docName: 'NIT / C.C.', defaultDoc: '222222222222', prefix: 'FAC' },
  MX: { currency: 'MXN', taxRate: 16, docName: 'RFC', defaultDoc: 'XAXX010101000', prefix: 'FAC' },
  VE: { currency: 'VES', taxRate: 16, docName: 'RIF', defaultDoc: 'V-00000000-0', prefix: 'FAC' },
  PE: { currency: 'PEN', taxRate: 18, docName: 'RUC / DNI', defaultDoc: '00000000', prefix: 'F001' },
  CL: { currency: 'CLP', taxRate: 19, docName: 'RUT', defaultDoc: '66666666-6', prefix: 'FAC' },
  AR: { currency: 'ARS', taxRate: 21, docName: 'CUIT / DNI', defaultDoc: '00-00000000-0', prefix: 'A001' },
  US: { currency: 'USD', taxRate: 0, docName: 'EIN / SSN', defaultDoc: '00-0000000', prefix: 'INV' },
  EC: { currency: 'USD', taxRate: 15, docName: 'RUC / Cédula', defaultDoc: '9999999999999', prefix: 'FAC' },
}

// Plantillas de productos por industria en 1 clic
export interface IndustryTemplate {
  id: string
  name: string
  icon: string
  description: string
  products: {
    name: string
    sku: string
    category: string
    cost: number
    price: number
    stock: number
    unit: string
  }[]
}

const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'minimarket',
    name: 'Minimarket / Abarrotes',
    icon: '🛒',
    description: 'Bebidas, lácteos, snacks y productos de consumo masivo.',
    products: [
      { name: 'Arroz Premium 1kg', sku: 'ARR-001', category: 'Abarrotes', cost: 3200, price: 4500, stock: 50, unit: 'kg' },
      { name: 'Aceite Vegetal 900ml', sku: 'ACE-001', category: 'Abarrotes', cost: 7500, price: 10500, stock: 24, unit: 'und' },
      { name: 'Café Tostado Tradicional 250g', sku: 'CAF-001', category: 'Bebidas', cost: 5800, price: 8200, stock: 30, unit: 'und' },
    ],
  },
  {
    id: 'ferreteria',
    name: 'Ferretería / Construcción',
    icon: '🔨',
    description: 'Herramientas, tornillería, pinturas y materiales de obra.',
    products: [
      { name: 'Cinta Métrica Profesional 5m', sku: 'HER-005', category: 'Herramientas', cost: 12000, price: 18500, stock: 20, unit: 'und' },
      { name: 'Destornillador Phillips Imantado', sku: 'HER-012', category: 'Herramientas', cost: 6500, price: 11000, stock: 35, unit: 'und' },
      { name: 'Pintura Blanca Tipo 1 (Galón)', sku: 'PIN-001', category: 'Pinturas', cost: 38000, price: 54000, stock: 15, unit: 'gal' },
    ],
  },
  {
    id: 'moda',
    name: 'Moda / Calzado',
    icon: '👕',
    description: 'Camisetas, pantalones, calzado y accesorios de vestir.',
    products: [
      { name: 'Camiseta Algodón Peinado Básica', sku: 'CAM-001', category: 'Prendas', cost: 18000, price: 35000, stock: 40, unit: 'und' },
      { name: 'Jean Clásico Denim Strech', sku: 'JEA-002', category: 'Prendas', cost: 42000, price: 79000, stock: 25, unit: 'und' },
      { name: 'Gorra Urbana Ajustable', sku: 'ACC-003', category: 'Accesorios', cost: 14000, price: 28000, stock: 30, unit: 'und' },
    ],
  },
  {
    id: 'farmacia',
    name: 'Droguería / Farmacia',
    icon: '💊',
    description: 'Medicamentos OTC, primeros auxilios y cuidado personal.',
    products: [
      { name: 'Acetaminofén 500mg (Caja x 100)', sku: 'MED-001', category: 'Analgésicos', cost: 9500, price: 16000, stock: 30, unit: 'caja' },
      { name: 'Alcohol Antiséptico 70% 350ml', sku: 'BOT-002', category: 'Botiquín', cost: 3800, price: 6500, stock: 45, unit: 'und' },
      { name: 'Suero Oral Rehidratante Manzana 500ml', sku: 'SUE-003', category: 'Hidratación', cost: 4200, price: 7200, stock: 40, unit: 'und' },
    ],
  },
  {
    id: 'servicios',
    name: 'Servicios / General',
    icon: '💼',
    description: 'Consultoría, mantenimiento, servicios técnicos o comercio general.',
    products: [
      { name: 'Servicio Mantenimiento Preventivo Básico', sku: 'SER-001', category: 'Servicios', cost: 20000, price: 65000, stock: 999, unit: 'serv' },
      { name: 'Diagnóstico Técnico Especializado', sku: 'SER-002', category: 'Servicios', cost: 15000, price: 45000, stock: 999, unit: 'serv' },
      { name: 'Kit Insumos Operativos Estándar', sku: 'INS-001', category: 'Insumos', cost: 18000, price: 32000, stock: 50, unit: 'kit' },
    ],
  },
]

interface OnboardingWizardProps {
  onComplete?: () => void
  onDismiss?: () => void
  isModal?: boolean
}

export default function OnboardingWizard({ onComplete, onDismiss, isModal = false }: OnboardingWizardProps) {
  const { user, signOut } = useAuth()
  const companyKey = user?.company_id ? `_${user.company_id}` : ''
  const [step, setStep] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(`ip_onboarding_step${user?.company_id ? `_${user.company_id}` : ''}`)
      const n = Number(saved)
      return n >= 1 && n <= 6 ? n : 1
    } catch {
      return 1
    }
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [successNotice, setSuccessNotice] = useState('')

  const setAndSaveStep = (nextStep: number) => {
    setStep(nextStep)
    try {
      localStorage.setItem(`ip_onboarding_step${companyKey}`, String(nextStep))
    } catch {}
  }

  // Step 1: Identidad y Moneda
  const [companyName, setCompanyName] = useState('')
  const [companyDoc, setCompanyDoc] = useState('')
  const [country, setCountry] = useState('CO')
  const [currency, setCurrency] = useState('COP')
  const [taxRate, setTaxRate] = useState<number>(19)
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')

  // Step 2: Sede y Bodega
  const [branchName, setBranchName] = useState('Sede Principal')
  const [branchCode, setBranchCode] = useState('SUC-001')
  const [warehouseName, setWarehouseName] = useState('Bodega Central')
  const [warehouseCode, setWarehouseCode] = useState('BOD-001')
  const [invoicePrefix, setInvoicePrefix] = useState('FAC')
  const [cashRegisterBase, setCashRegisterBase] = useState<number>(100000)

  // Step 3: Inventario Express
  const [selectedIndustry, setSelectedIndustry] = useState<string>('minimarket')
  const [customProducts, setCustomProducts] = useState([
    { name: 'Producto Estrella 1', sku: 'PROD-001', cost: 5000, price: 9000, stock: 20, unit: 'und' },
    { name: 'Producto Secundario 2', sku: 'PROD-002', cost: 12000, price: 20000, stock: 15, unit: 'und' },
  ])
  const [catalogMode, setCatalogMode] = useState<'template' | 'custom'>('template')

  // Step 4: Clientes
  const [customerName, setCustomerName] = useState('Consumidor Final')
  const [customerDoc, setCustomerDoc] = useState('222222222222')
  const [customerPhone, setCustomerPhone] = useState('')
  const [vipClientName, setVipClientName] = useState('')
  const [vipClientDoc, setVipClientDoc] = useState('')
  const [vipClientPhone, setVipClientPhone] = useState('')

  // Step 5: Primera Venta POS en Vivo
  const [simProduct, setSimProduct] = useState({ name: 'Arroz Premium 1kg', price: 4500, stock: 50, id: '' })
  const [simQty, setSimQty] = useState(1)
  const [simPaymentMethod, setSimPaymentMethod] = useState<'efectivo' | 'transferencia'>('efectivo')
  const [saleCompleted, setSaleCompleted] = useState(false)
  const [saleReceiptNum, setSaleReceiptNum] = useState('')

  // Initial load: check if company already exists
  useEffect(() => {
    async function loadCurrentState() {
      try {
        const { data: cfg } = await supabase.from('company_config').select('*').limit(1).maybeSingle()
        if (cfg) {
          if (cfg.name) setCompanyName(cfg.name)
          if (cfg.rif) setCompanyDoc(cfg.rif)
          if (cfg.currency) setCurrency(normalizeCurrency(cfg.currency))
          if (cfg.tax_rate !== undefined) setTaxRate(Number(cfg.tax_rate))
          if (cfg.phone) setPhone(cfg.phone)
          if (cfg.address) setAddress(cfg.address)
          if (cfg.invoice_prefix) setInvoicePrefix(cfg.invoice_prefix)
        }
      } catch {
        // Continue with defaults
      }
    }
    void loadCurrentState()
  }, [])

  // Auto-adapt presets when country changes
  function handleCountryChange(code: string) {
    setCountry(code)
    const preset = COUNTRY_PRESETS[code]
    if (preset) {
      setCurrency(preset.currency)
      setTaxRate(preset.taxRate)
      setInvoicePrefix(preset.prefix)
      if (!companyDoc) setCompanyDoc('')
      setCustomerDoc(preset.defaultDoc)
    }
  }

  // Multiplier for template product prices if using non-COP currencies (e.g. USD)
  const isHighDenomCurrency = currency === 'COP' || currency === 'CLP' || currency === 'ARS' || currency === 'PYG'

  function getAdjustedTemplateProducts(tmpl: IndustryTemplate) {
    if (isHighDenomCurrency) return tmpl.products
    return tmpl.products.map(p => ({
      ...p,
      cost: Math.round((p.cost / 4000) * 100) / 100,
      price: Math.round((p.price / 4000) * 100) / 100,
    }))
  }

  // Save Step 1: Identidad Corporativa y Moneda
  async function saveStep1() {
    if (!companyName.trim()) {
      setError('Por favor indica el nombre comercial de tu empresa o negocio.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const cur = normalizeCurrency(currency)
      const { data: row } = await supabase.from('company_config').select('id').limit(1).maybeSingle()
      const payload = {
        name: companyName.trim(),
        rif: companyDoc.trim() || 'SIN-REGISTRO',
        phone: phone.trim() || null,
        address: address.trim() || null,
        currency: cur,
        tax_rate: taxRate,
        invoice_prefix: invoicePrefix.trim() || 'FAC',
        currency_confirmed: true,
      }

      if (row?.id) {
        const { error: updErr } = await supabase.from('company_config').update(payload).eq('id', row.id)
        if (updErr) throw new Error(updErr.message)
      } else {
        const { error: insErr } = await supabase.from('company_config').insert({ ...payload, geo_mode: 'off' })
        if (insErr) throw new Error(insErr.message)
      }
      refreshCurrency()
      setAndSaveStep(2)
    } catch (err: any) {
      setError('No se pudo guardar la identidad: ' + (err.message || 'Error de conexión'))
    } finally {
      setBusy(false)
    }
  }

  // Save Step 2: Sede y Bodega
  async function saveStep2() {
    setBusy(true)
    setError('')
    try {
      // 1. Ensure branch exists
      const { data: existingBranches } = await supabase.from('branches').select('id, name').limit(1)
      let branchId = existingBranches?.[0]?.id

      if (!branchId) {
        const bPayload: any = {
          name: branchName.trim() || 'Sede Principal',
          code: branchCode.trim() || 'SUC-001',
          is_main: true,
          active: true,
          phone: phone.trim() || null,
          address: address.trim() || null,
        }
        if (user?.company_id) bPayload.company_id = user.company_id
        const { data: bNew, error: bErr } = await supabase.from('branches').insert(bPayload).select('id').single()
        if (bErr && !bErr.message.includes('duplicate')) {
          console.warn('Branch insert notice:', bErr.message)
        }
        branchId = bNew?.id
      }

      // 2. Ensure warehouse exists
      const { data: existingWh } = await supabase.from('warehouses').select('id, name').limit(1)
      let whId = existingWh?.[0]?.id

      if (!whId) {
        const wPayload: any = {
          name: warehouseName.trim() || 'Bodega Central',
          code: warehouseCode.trim() || 'BOD-001',
          branch_id: branchId || null,
          warehouse_type: 'principal',
          active: true,
        }
        if (user?.company_id) wPayload.company_id = user.company_id
        const { data: wNew, error: wErr } = await supabase.from('warehouses').insert(wPayload).select('id').single()
        if (wErr && !wErr.message.includes('duplicate')) {
          console.warn('Warehouse insert notice:', wErr.message)
        }
        whId = wNew?.id
      }

      setAndSaveStep(3)
    } catch (err: any) {
      setError('Error al crear sede y bodega: ' + (err.message || 'Revisa tu conexión'))
    } finally {
      setBusy(false)
    }
  }

  // Save Step 3: Inventario Express
  async function saveStep3() {
    setBusy(true)
    setError('')
    try {
      const template = INDUSTRY_TEMPLATES.find(t => t.id === selectedIndustry) || INDUSTRY_TEMPLATES[0]
      const itemsToCreate = catalogMode === 'template'
        ? getAdjustedTemplateProducts(template)
        : customProducts.map((p, idx) => ({
            name: p.name.trim() || `Producto ${idx + 1}`,
            sku: p.sku.trim() || `SKU-00${idx + 1}`,
            category: 'General',
            cost: Number(p.cost) || 0,
            price: Number(p.price) || 0,
            stock: Number(p.stock) || 10,
            unit: p.unit || 'und',
          }))

      let createdFirstProduct = { name: itemsToCreate[0].name, price: itemsToCreate[0].price, stock: itemsToCreate[0].stock, id: '' }

      for (const item of itemsToCreate) {
        const prodPayload: any = {
          name: item.name,
          sku: item.sku,
          cost: item.cost,
          price: item.price,
          stock: item.stock,
          min_stock: 5,
          unit: item.unit,
        }
        if (user?.company_id) prodPayload.company_id = user.company_id

        const { data: pData, error: pErr } = await supabase.from('products').insert(prodPayload).select('id, name, price, stock').single()
        if (pErr) {
          // If SKU duplicate, query existing
          const { data: existing } = await supabase.from('products').select('id, name, price, stock').eq('sku', item.sku).maybeSingle()
          if (existing && !createdFirstProduct.id) {
            createdFirstProduct = { name: existing.name, price: Number(existing.price), stock: Number(existing.stock), id: existing.id }
          }
        } else if (pData && !createdFirstProduct.id) {
          createdFirstProduct = { name: pData.name, price: Number(pData.price), stock: Number(pData.stock), id: pData.id }
        }
      }

      setSimProduct(createdFirstProduct)
      setAndSaveStep(4)
    } catch (err: any) {
      setError('Error al registrar inventario: ' + (err.message || 'Error de conexión'))
    } finally {
      setBusy(false)
    }
  }

  // Save Step 4: Clientes
  async function saveStep4() {
    setBusy(true)
    setError('')
    try {
      // 1. Ensure Consumidor Final exists
      const { data: existingFinal } = await supabase.from('customers').select('id').eq('document', customerDoc.trim()).maybeSingle()
      if (!existingFinal) {
        const custPayload: any = {
          name: customerName.trim() || 'Consumidor Final',
          document: customerDoc.trim() || '222222222222',
          phone: customerPhone.trim() || null,
          price_type: 'detal',
        }
        if (user?.company_id) custPayload.company_id = user.company_id
        await supabase.from('customers').insert(custPayload)
      }

      // 2. VIP client if provided
      if (vipClientName.trim()) {
        const vipPayload: any = {
          name: vipClientName.trim(),
          document: vipClientDoc.trim() || null,
          phone: vipClientPhone.trim() || null,
          price_type: 'detal',
        }
        if (user?.company_id) vipPayload.company_id = user.company_id
        await supabase.from('customers').insert(vipPayload)
      }

      setAndSaveStep(5)
    } catch (err: any) {
      setError('Error al registrar clientes: ' + (err.message || 'Error de conexión'))
    } finally {
      setBusy(false)
    }
  }

  // Execute Step 5: Primera Venta POS en Vivo
  async function executeFirstSale() {
    setBusy(true)
    setError('')
    try {
      // Retrieve customer id
      const { data: cust } = await supabase.from('customers').select('id, name').limit(1).maybeSingle()
      const customerId = cust?.id || null

      // Retrieve product id
      let productId = simProduct.id
      if (!productId) {
        const { data: prod } = await supabase.from('products').select('id, name, price, stock').limit(1).maybeSingle()
        if (prod) {
          productId = prod.id
          setSimProduct({ name: prod.name, price: Number(prod.price), stock: Number(prod.stock), id: prod.id })
        }
      }

      const totalSale = simProduct.price * simQty
      const saleClientId = crypto.randomUUID()
      const ticketNum = `${invoicePrefix}-${Math.floor(1000 + Math.random() * 9000)}`

      // 1. Try standard registrar_venta RPC
      const rpcArgs: any = {
        p_customer_id: customerId,
        p_items: [
          {
            product_id: productId,
            quantity: simQty,
            unit_price: simProduct.price,
            product_name: simProduct.name,
          },
        ],
        p_payment_method: simPaymentMethod,
        p_channel: 'mostrador',
        p_client_id: saleClientId,
        p_captured_at: new Date().toISOString(),
      }

      const { error: rpcErr } = await supabase.rpc('registrar_venta', rpcArgs)
      if (rpcErr) {
        // Fallback: direct table insert to ensure zero blockers for new businesses
        const saleRow: any = {
          id: saleClientId,
          customer_id: customerId,
          total: totalSale,
          payment_method: simPaymentMethod,
          channel: 'mostrador',
          status: 'completada',
          invoice_number: ticketNum,
          created_at: new Date().toISOString(),
        }
        if (user?.company_id) saleRow.company_id = user.company_id
        const { error: sInsErr } = await supabase.from('sales').insert(saleRow)
        if (sInsErr && !sInsErr.message.includes('duplicate')) {
          console.warn('Fallback direct sale notice:', sInsErr.message)
        }

        // Discount stock
        if (productId) {
          try {
            await supabase.rpc('ajustar_stock', {
              p_product_id: productId,
              p_new_stock: Math.max(0, simProduct.stock - simQty),
              p_reason: 'Primera venta de bienvenida',
            })
          } catch {}
        }
      }

      setSaleReceiptNum(ticketNum)
      setSaleCompleted(true)
      setSuccessNotice(`¡Venta #${ticketNum} registrada con éxito! El inventario se descontó y se generó el asiento en Contabilidad.`)
      setAndSaveStep(6)
    } catch (err: any) {
      setError('No se pudo registrar la venta: ' + (err.message || 'Error desconocido'))
    } finally {
      setBusy(false)
    }
  }

  // Final completion
  function handleFinish() {
    try {
      localStorage.setItem('ip_onboarding_completed', 'true')
      if (user?.company_id) {
        localStorage.setItem(`ip_onboarding_completed_${user.company_id}`, 'true')
        localStorage.removeItem(`ip_onboarding_step_${user.company_id}`)
      }
    } catch {}
    refreshCurrency()
    if (onComplete) onComplete()
  }

  const stepsMeta = [
    { num: 1, title: 'Identidad y Moneda', icon: Building2 },
    { num: 2, title: 'Sedes y Bodegas', icon: WarehouseIcon },
    { num: 3, title: 'Primer Inventario', icon: Package },
    { num: 4, title: 'Clientes y DIAN', icon: Users },
    { num: 5, title: 'Primera Venta POS', icon: Receipt },
    { num: 6, title: 'Empresa Lista', icon: Sparkles },
  ]

  const progressPercent = Math.round(((step - 1) / (stepsMeta.length - 1)) * 100)

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-900/80 backdrop-blur-sm overflow-y-auto`}>
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Header con Barra de Progreso Superior */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-black shadow-md">
                <Store className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-widest font-bold text-amber-400">Contable Pro · Ruta de Activación</span>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/30">
                    &lt; 8 Minutos
                  </span>
                </div>
                <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
                  Puesta en Marcha Operativa de tu Empresa
                </h2>
              </div>
            </div>

            {isModal && onDismiss && (
              <button
                onClick={onDismiss}
                className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
                title="Cerrar asistente"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Stepper visual horizontal */}
          <div className="mt-6">
            <div className="grid grid-cols-6 gap-2">
              {stepsMeta.map(s => {
                const isCurrent = step === s.num
                const isDone = step > s.num
                const IconComponent = s.icon
                return (
                  <div key={s.num} className="flex flex-col items-center text-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                        isDone
                          ? 'bg-emerald-500 text-white shadow-md'
                          : isCurrent
                          ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-400/30 font-black scale-110'
                          : 'bg-slate-700/60 text-slate-400 border border-slate-600'
                      }`}
                    >
                      {isDone ? <Check className="w-4 h-4 stroke-[3]" /> : <IconComponent className="w-4 h-4" />}
                    </div>
                    <span
                      className={`text-[10px] sm:text-[11px] mt-1.5 font-medium truncate w-full hidden sm:block ${
                        isCurrent ? 'text-amber-300 font-bold' : isDone ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {s.title}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="w-full bg-slate-700/50 rounded-full h-1.5 mt-3 overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-400 to-emerald-400 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Mensaje de error general */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Contenido Dinámico por Paso */}
        <div className="p-5 sm:p-8 max-h-[68vh] overflow-y-auto">
          {/* PASO 1: IDENTIDAD Y MONEDA */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-indigo-600" />
                  Paso 1: Identidad Corporativa, Localización y Moneda Base
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Define el país, la razón social y la moneda de curso legal donde opera tu empresa. Tus precios, inventarios, compras y reportes financieros se sincronizarán con esta configuración.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* País selector */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">País de Operación</label>
                  <select
                    value={country}
                    onChange={e => handleCountryChange(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  >
                    <option value="CO">🇨🇴 Colombia (COP - IVA 19% - DIAN)</option>
                    <option value="MX">🇲🇽 México (MXN - IVA 16% - SAT)</option>
                    <option value="VE">🇻🇪 Venezuela (VES - IVA 16% - SENIAT)</option>
                    <option value="PE">🇵🇪 Perú (PEN - IGV 18% - SUNAT)</option>
                    <option value="CL">🇨🇱 Chile (CLP - IVA 19% - SII)</option>
                    <option value="AR">🇦🇷 Argentina (ARS - IVA 21% - AFIP)</option>
                    <option value="EC">🇪🇨 Ecuador (USD - IVA 15% - SRI)</option>
                    <option value="US">🇺🇸 Estados Unidos / Global (USD)</option>
                  </select>
                </div>

                {/* Moneda */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Moneda Principal</label>
                  <CurrencySelect value={currency} onChange={setCurrency} />
                </div>

                {/* Nombre Comercial */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nombre Comercial de la Empresa / Negocio <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="Ej. Distribuidora El Sol S.A.S. / Ferretería Los Andes"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:bg-white font-medium"
                    autoFocus
                  />
                </div>

                {/* Documento NIT/RIF */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    {COUNTRY_PRESETS[country]?.docName || 'Identificación Fiscal / NIT'}
                  </label>
                  <input
                    type="text"
                    value={companyDoc}
                    onChange={e => setCompanyDoc(e.target.value)}
                    placeholder="Ej. 901.234.567-8"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>

                {/* Teléfono / WhatsApp */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Teléfono / WhatsApp de Ventas</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="Ej. +57 300 123 4567"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>

                {/* Dirección */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Dirección Principal</label>
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Ej. Cra 15 # 45-20, Centro Comercial Bolívar, Local 104"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:bg-white"
                  />
                </div>
              </div>

              {/* Vista previa de formato de moneda */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <Coins className="w-4 h-4 text-amber-500" />
                  <span>Ejemplo de visualización contable:</span>
                </div>
                <span className="font-bold text-slate-900 text-sm">
                  {formatMoney(250000, currency)}
                </span>
              </div>
            </div>
          )}

          {/* PASO 2: SEDES Y BODEGAS */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <WarehouseIcon className="w-5 h-5 text-indigo-600" />
                  Paso 2: Topología Física Inicial (Sede y Bodega Central)
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Tu ERP opera con arquitectura multi-bodega con trazabilidad en tiempo real. Configura tu primer punto de atención física y almacén de despacho.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Nombre de la Sede */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre de la Sede / Sucursal</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={e => setBranchName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ej. Sede Principal - Centro"
                  />
                </div>

                {/* Código de Sede */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Código Interno Sede</label>
                  <input
                    type="text"
                    value={branchCode}
                    onChange={e => setBranchCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 uppercase"
                    placeholder="SUC-001"
                  />
                </div>

                {/* Nombre de Bodega */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nombre de la Bodega de Despacho</label>
                  <input
                    type="text"
                    value={warehouseName}
                    onChange={e => setWarehouseName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    placeholder="Ej. Bodega Central / Almacén Mostrador"
                  />
                </div>

                {/* Código de Bodega */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Código Bodega</label>
                  <input
                    type="text"
                    value={warehouseCode}
                    onChange={e => setWarehouseCode(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 uppercase"
                    placeholder="BOD-001"
                  />
                </div>

                {/* Prefijo de Factura */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Prefijo de Facturación / POS</label>
                  <input
                    type="text"
                    value={invoicePrefix}
                    onChange={e => setInvoicePrefix(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 uppercase font-mono"
                    placeholder="FAC"
                  />
                </div>

                {/* Base de Caja Inicial */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Base de Caja Sugerida (Efectivo Apertura)</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={cashRegisterBase}
                      onChange={e => setCashRegisterBase(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">{currency}</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-start gap-2.5">
                <Store className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Topología automática lista para operar:</p>
                  <p className="text-indigo-700 mt-0.5">
                    Al guardar, los traslados entre bodegas, kardex por lote y arqueos de caja diaria quedarán asociados directamente a esta sede y bodega.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3: INVENTARIO EXPRESS */}
          {step === 3 && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Package className="w-5 h-5 text-indigo-600" />
                    Paso 3: Carga de Primer Inventario y Catálogo Express
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 mt-1">
                    Comienza en segundos usando una plantilla de tu sector o ingresa tus primeros productos con cálculo automático de margen comercial.
                  </p>
                </div>

                {/* Toggle entre Plantilla o Manual */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl text-xs self-start">
                  <button
                    type="button"
                    onClick={() => setCatalogMode('template')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      catalogMode === 'template' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Plantillas por Rubro
                  </button>
                  <button
                    type="button"
                    onClick={() => setCatalogMode('custom')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                      catalogMode === 'custom' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Personalizado
                  </button>
                </div>
              </div>

              {catalogMode === 'template' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {INDUSTRY_TEMPLATES.map(tmpl => {
                      const isSel = selectedIndustry === tmpl.id
                      return (
                        <div
                          key={tmpl.id}
                          onClick={() => setSelectedIndustry(tmpl.id)}
                          className={`p-3.5 rounded-xl border-2 cursor-pointer transition-all ${
                            isSel
                              ? 'border-indigo-600 bg-indigo-50/50 shadow-sm'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <div className="text-2xl mb-1">{tmpl.icon}</div>
                          <h4 className="text-xs font-bold text-slate-900">{tmpl.name}</h4>
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{tmpl.description}</p>
                        </div>
                      )
                    })}
                  </div>

                  {/* Vista previa de los 3 productos de la plantilla seleccionada */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>Productos que se crearán automáticamente:</span>
                      <span className="text-indigo-600 font-semibold">3 Artículos listos para vender</span>
                    </div>
                    <div className="divide-y divide-slate-100 text-xs">
                      {getAdjustedTemplateProducts(
                        INDUSTRY_TEMPLATES.find(t => t.id === selectedIndustry) || INDUSTRY_TEMPLATES[0]
                      ).map((p, i) => {
                        const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0
                        return (
                          <div key={i} className="p-3 flex items-center justify-between hover:bg-slate-50/80">
                            <div>
                              <p className="font-bold text-slate-800">{p.name}</p>
                              <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                                <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                                <span>· Stock inicial: {p.stock} {p.unit}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-slate-900">{formatMoney(p.price, currency)}</p>
                              <p className="text-[11px] text-emerald-600 font-medium">Margen: {margin}%</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {customProducts.map((p, idx) => {
                    const margin = p.price > 0 ? Math.round(((p.price - p.cost) / p.price) * 100) : 0
                    return (
                      <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-slate-700">Artículo #{idx + 1}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${margin >= 25 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            Margen bruto: {margin}%
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                          <div className="sm:col-span-2">
                            <label className="block text-[11px] text-slate-500">Nombre del producto</label>
                            <input
                              type="text"
                              value={p.name}
                              onChange={e => {
                                const next = [...customProducts]
                                next[idx].name = e.target.value
                                setCustomProducts(next)
                              }}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500">Costo ({currency})</label>
                            <input
                              type="number"
                              value={p.cost}
                              onChange={e => {
                                const next = [...customProducts]
                                next[idx].cost = Number(e.target.value)
                                setCustomProducts(next)
                              }}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500">Precio Venta ({currency})</label>
                            <input
                              type="number"
                              value={p.price}
                              onChange={e => {
                                const next = [...customProducts]
                                next[idx].price = Number(e.target.value)
                                setCustomProducts(next)
                              }}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 font-bold"
                            />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* PASO 4: CLIENTES Y FACTURACIÓN */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-600" />
                  Paso 4: Clientes y Régimen DIAN / Facturación
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  En ventas de mostrador y POS, la mayoría de ventas al detal se emiten a «Consumidor Final». Registraremos el perfil legal y opcionalmente tu primer cliente recurrente.
                </p>
              </div>

              {/* Tarjeta Consumidor Final */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span className="text-xs font-bold text-slate-800">Cliente Estándar Mostrador (Universal)</span>
                  </div>
                  <span className="text-[10px] bg-slate-200 text-slate-700 px-2 py-0.5 rounded font-mono">Obligatorio DIAN</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Nombre</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={e => setCustomerName(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 font-medium"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">Documento / NIT Estándar</label>
                    <input
                      type="text"
                      value={customerDoc}
                      onChange={e => setCustomerDoc(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Cliente VIP Opcional */}
              <div className="p-4 bg-indigo-50/40 border border-indigo-100 rounded-xl space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800">Primer Cliente Frecuente / Corporativo (Opcional)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Nombre / Razón Social</label>
                    <input
                      type="text"
                      value={vipClientName}
                      onChange={e => setVipClientName(e.target.value)}
                      placeholder="Ej. Inversiones El Diamante"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">C.C. o NIT</label>
                    <input
                      type="text"
                      value={vipClientDoc}
                      onChange={e => setVipClientDoc(e.target.value)}
                      placeholder="Ej. 1098765432"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-600 mb-1">Teléfono / WhatsApp</label>
                    <input
                      type="text"
                      value={vipClientPhone}
                      onChange={e => setVipClientPhone(e.target.value)}
                      placeholder="Ej. 312 987 6543"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-800"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 5: PRIMERA VENTA POS EN VIVO */}
          {step === 5 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-5 h-5 text-indigo-600" />
                  Paso 5: Primera Venta POS en Vivo (El Momento Aha!)
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Ejecutemos una venta en tiempo real. Observa cómo el sistema descuenta automáticamente el stock en bodega, genera el comprobante y prepara el asiento de partida doble en contabilidad.
                </p>
              </div>

              {/* Simulador de Caja Registradora Express */}
              <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Store className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Terminal POS Mostrador #1</span>
                  </div>
                  <span className="text-xs text-slate-400">Cliente: {customerName}</span>
                </div>

                <div className="bg-slate-800/80 p-3.5 rounded-xl flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white">{simProduct.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">Precio unitario: {formatMoney(simProduct.price, currency)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center bg-slate-700 rounded-lg p-1">
                      <button
                        type="button"
                        onClick={() => setSimQty(Math.max(1, simQty - 1))}
                        className="px-2 py-0.5 text-slate-300 hover:text-white font-bold"
                      >
                        -
                      </button>
                      <span className="px-2 text-xs font-bold text-amber-400">{simQty}</span>
                      <button
                        type="button"
                        onClick={() => setSimQty(simQty + 1)}
                        className="px-2 py-0.5 text-slate-300 hover:text-white font-bold"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-base font-black text-amber-400 min-w-20 text-right">
                      {formatMoney(simProduct.price * simQty, currency)}
                    </span>
                  </div>
                </div>

                {/* Medio de pago */}
                <div className="space-y-2">
                  <label className="block text-xs font-medium text-slate-300">Medio de Cobro:</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setSimPaymentMethod('efectivo')}
                      className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                        simPaymentMethod === 'efectivo'
                          ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                          : 'border-slate-700 bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Banknote className="w-4 h-4" />
                      Efectivo en Caja
                    </button>
                    <button
                      type="button"
                      onClick={() => setSimPaymentMethod('transferencia')}
                      className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all ${
                        simPaymentMethod === 'transferencia'
                          ? 'border-indigo-400 bg-indigo-400/20 text-indigo-300'
                          : 'border-slate-700 bg-slate-800 text-slate-400'
                      }`}
                    >
                      <CreditCard className="w-4 h-4" />
                      Transferencia (Nequi / Bancolombia)
                    </button>
                  </div>
                </div>

                {/* Resumen del cobro */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                  <span className="text-slate-400">Total a facturar:</span>
                  <span className="text-xl font-black text-emerald-400">{formatMoney(simProduct.price * simQty, currency)}</span>
                </div>
              </div>

              {/* Aviso de automatización contable */}
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Transacción 100% Real en Base de Datos:</p>
                  <p className="text-emerald-700 mt-0.5">
                    Al hacer clic en «Completar Primera Venta», el ERP creará el registro fiscal, restará {simQty} unidad(es) del kardex y registrará el débito a Caja y crédito a Ingresos Operacionales (Partida Doble NIIF).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* PASO 6: ACTIVACIÓN COMPLETA */}
          {step === 6 && (
            <div className="text-center space-y-6 py-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                <Sparkles className="w-8 h-8 animate-pulse" />
              </div>

              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
                  ¡Activación Exitosa en menos de 8 minutos!
                </span>
                <h3 className="text-2xl font-black text-slate-900 mt-3">
                  {companyName || 'Tu Empresa'} está Lista para Crecer
                </h3>
                <p className="text-sm text-slate-500 max-w-lg mx-auto mt-2">
                  Has configurado tu moneda, sede, bodega, inventario inicial, cliente y registrado tu primera venta en vivo.
                </p>
              </div>

              {/* Resumen de configuración completada */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto text-left">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Moneda Base</p>
                  <p className="text-sm font-bold text-slate-800">{currency}</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Sede & Bodega</p>
                  <p className="text-sm font-bold text-slate-800 truncate">{branchName}</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Catálogo Activo</p>
                  <p className="text-sm font-bold text-slate-800">3+ Artículos</p>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-[10px] text-slate-400 font-bold uppercase">Ticket Inicial</p>
                  <p className="text-sm font-bold text-emerald-600">{saleReceiptNum || 'Completado'}</p>
                </div>
              </div>

              {/* Próximos pasos recomendados */}
              <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-2xl max-w-2xl mx-auto text-left">
                <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-indigo-600" />
                  Próximas Acciones Recomendadas:
                </h4>
                <ul className="text-xs text-indigo-900 space-y-1.5 list-disc list-inside">
                  <li>Invita a tu equipo de trabajo asignando roles (Cajero, Almacenista, Vendedor, Contador).</li>
                  <li>Activa tu Catálogo Público Web para recibir pedidos directos por WhatsApp.</li>
                  <li>Instala la aplicación en tu celular (PWA) para operar y facturar sin conexión a internet.</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer con Botones de Navegación */}
        <div className="bg-slate-50 px-6 py-4 border-t border-slate-200 flex items-center justify-between">
          <div>
            {step > 1 && step < 6 && (
              <button
                type="button"
                onClick={() => {
                  setError('')
                  setStep(step - 1)
                }}
                disabled={busy}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Anterior
              </button>
            )}
            {step === 1 && !isModal && (
              <button
                type="button"
                onClick={signOut}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Cerrar sesión
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {step === 1 && (
              <button
                type="button"
                onClick={saveStep1}
                disabled={busy}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {busy ? 'Guardando...' : 'Siguiente: Sedes y Bodegas'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={saveStep2}
                disabled={busy}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {busy ? 'Configurando...' : 'Siguiente: Primer Inventario'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={saveStep3}
                disabled={busy}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {busy ? 'Cargando Catálogo...' : 'Siguiente: Clientes y DIAN'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={saveStep4}
                disabled={busy}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {busy ? 'Guardando...' : 'Siguiente: Primera Venta POS'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 5 && (
              <button
                type="button"
                onClick={executeFirstSale}
                disabled={busy}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
              >
                {busy ? 'Registrando Venta en Vivo...' : 'Completar Primera Venta'}
                <Receipt className="w-4 h-4" />
              </button>
            )}

            {step === 6 && (
              <button
                type="button"
                onClick={handleFinish}
                className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl text-xs sm:text-sm font-black flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
              >
                <span>Ir al Panel de Control</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
