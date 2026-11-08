import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, canManageSettings } from '../lib/auth'
import type { CompanyConfig } from '../types'
import { CURRENCIES, formatMoney, normalizeCurrency, parseFxRates, refreshCurrency } from '../lib/currency'
import CurrencySelect from '../components/CurrencySelect'
import SqlActivationModal from '../components/SqlActivationModal'
import CatalogBrandModal, { type CatalogBrandModalTab } from '../components/CatalogBrandModal'
import { slugifyStoreAlias } from '../lib/whatsappStudio'
import { taxModeOf, type TaxMode } from '../lib/tax'
import { Save, Settings as SettingsIcon, Lock, Plus, Trash2, AlertTriangle, Database, Palette, MessageCircle } from 'lucide-react'

const EMPTY: CompanyConfig = { id: '', name: '', rif: '', address: '', phone: '', email: '', currency: 'USD', tax_rate: 0, invoice_prefix: 'FAC', geo_mode: 'off' }

type Cfg = CompanyConfig & { currency_confirmed?: boolean; fx_rates?: Record<string, number> }
type FxRow = { code: string; rate: string }
const parseRate = (s: string) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : 0 }

export default function Settings() {
  const { user } = useAuth()
  const canEdit = canManageSettings(user?.role)
  const [config, setConfig] = useState<Cfg | null>(null)
  const [origName, setOrigName] = useState('')
  const [origCurrency, setOrigCurrency] = useState('USD')
  const [fxRows, setFxRows] = useState<FxRow[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [taxMode, setTaxMode] = useState<TaxMode>('none')
  const [confirmCurrencyPrompt, setConfirmCurrencyPrompt] = useState(false)
  const [sqlOpen, setSqlOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [brandTab, setBrandTab] = useState<CatalogBrandModalTab>('brand')

  useEffect(() => { void load() }, [])
  async function load() {
    const { data } = await supabase.from('company_config').select('*').limit(1).maybeSingle()
    const base = ((data as Cfg) || EMPTY) as Cfg
    setConfig({ ...base, currency: normalizeCurrency(base.currency), geo_mode: base.geo_mode ?? 'off' })
    setOrigName((base.name || '').trim())
    setOrigCurrency(normalizeCurrency(base.currency))
    setFxRows(Object.entries(parseFxRates(base.fx_rates)).map(([code, rate]) => ({ code, rate: String(rate) })))
    setTaxMode(taxModeOf(base))
  }

  async function persistSettings(forceCurrencyChange: boolean) {
    if (!config || !canEdit || saving) return
    setSaving(true); setSaved(false); setError('')

    const tax = Math.min(Math.max(Number(config.tax_rate) || 0, 0), 100)
    const newCur = normalizeCurrency(config.currency)

    // Cambiar la moneda no convierte lo ya registrado: se avisa antes si ya hay ventas
    if (config.id && newCur !== origCurrency && !forceCurrencyChange) {
      const { count } = await supabase.from('sales').select('id', { count: 'exact', head: true })
      if ((count ?? 0) > 0) {
        setSaving(false)
        setConfirmCurrencyPrompt(true)
        return
      }
    }

    setConfirmCurrencyPrompt(false)

    // Tasas de cambio válidas (sin repetir y sin la moneda de la empresa)
    const rates: Record<string, number> = {}
    for (const r of fxRows) {
      const code = r.code.trim().toUpperCase()
      const n = parseRate(r.rate)
      if (/^[A-Z]{3}$/.test(code) && code !== newCur && n > 0) rates[code] = n
    }

    const payload: Record<string, unknown> = { ...config, currency: newCur, tax_rate: tax, tax_mode: taxMode }
    if ('currency_confirmed' in config) payload.currency_confirmed = true
    if ('fx_rates' in config) payload.fx_rates = rates

    // Si el nombre comercial cambió y el alias del enlace era automático, sincronizar alias y eslogan de WhatsApp
    const trimmedNewName = (config.name || '').trim()
    // Generar siempre una nueva huella de versión comercial para obligar a WhatsApp y redes a refrescar su caché
    payload.brand_version = Math.random().toString(36).slice(2, 8)

    if (trimmedNewName && trimmedNewName.toLowerCase() !== origName.toLowerCase()) {
      const oldAutoSlug = slugifyStoreAlias(origName)
      const currentSlug = slugifyStoreAlias(config.catalog_slug)
      const newAutoSlug = slugifyStoreAlias(trimmedNewName)
      if (newAutoSlug && (!currentSlug || (oldAutoSlug && (currentSlug === oldAutoSlug || currentSlug.startsWith(`${oldAutoSlug}-`))))) {
        payload.catalog_slug = newAutoSlug
      }
      if (config.whatsapp_settings && typeof config.whatsapp_settings === 'object') {
        const prevTagline = String(config.whatsapp_settings.brand_tagline || '')
        payload.whatsapp_settings = {
          ...config.whatsapp_settings,
          brand_tagline: `Catálogo oficial de ${trimmedNewName} · Atención personalizada`,
        }
      }
    }

    let err: { message: string } | null = null
    let updatedRow: Cfg | null = null
    if (config.id) {
      const { id, ...rest } = payload
      void id
      const res = await supabase.from('company_config').update(rest).eq('id', config.id).select('*').maybeSingle()
      err = res.error
      if (res.data) updatedRow = res.data as Cfg
    } else {
      const { id, ...rest } = payload
      void id
      const res = await supabase.from('company_config').insert(rest).select('*').single()
      err = res.error
      if (res.data) updatedRow = res.data as Cfg
    }

    setSaving(false)
    if (err) { setError('No se pudo guardar: ' + err.message); return }
    if (updatedRow) {
      setConfig({
        ...updatedRow,
        currency: normalizeCurrency(updatedRow.currency),
        geo_mode: updatedRow.geo_mode ?? 'off',
      })
      setOrigName((updatedRow.name || '').trim())
    } else {
      setConfig(c => (c ? { ...c, ...(payload as Partial<Cfg>), currency: newCur, tax_rate: tax, ...('fx_rates' in c ? { fx_rates: rates } : {}) } : c))
      setOrigName(trimmedNewName)
    }
    setOrigCurrency(newCur)
    setFxRows(Object.entries(rates).map(([code, rate]) => ({ code, rate: String(rate) })))
    refreshCurrency()
    setSaved(true); setTimeout(() => setSaved(false), 3000)
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    void persistSettings(false)
  }

  if (!config) return <p className="text-sm text-slate-400">Cargando...</p>

  const input = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-50 disabled:text-slate-500'
  const baseCur = normalizeCurrency(config.currency)
  const fxReady = 'fx_rates' in config
  const usedCodes = new Set(fxRows.map(r => r.code))
  const nextCode = ['USD', 'EUR', 'COP', 'VES', 'MXN', 'BRL', 'PEN', 'ARS', 'CLP'].find(c => c !== baseCur && !usedCodes.has(c))
    ?? CURRENCIES.find(c => c.code !== baseCur && !usedCodes.has(c.code))?.code ?? 'USD'

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-bold text-slate-800">Configuración</h1><p className="text-sm text-slate-500 mt-1">Datos fiscales, moneda base y parámetros operativos de la empresa</p></div>

      {!canEdit && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs max-w-lg">
          <Lock className="w-3.5 h-3.5 shrink-0" /> Solo el dueño o el administrador de empresa pueden cambiar la configuración.
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg space-y-4">
        <div className="flex items-center gap-2 mb-2"><SettingsIcon className="w-4 h-4 text-slate-400" /><h2 className="text-sm font-bold text-slate-700">Información de la empresa</h2></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Nombre</label><input required disabled={!canEdit} value={config.name} onChange={e => setConfig({ ...config, name: e.target.value })} className={input} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">ID fiscal (NIT, RFC, RIF, RUT…)</label><input disabled={!canEdit} value={config.rif} onChange={e => setConfig({ ...config, rif: e.target.value })} className={input} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label><input disabled={!canEdit} value={config.phone} onChange={e => setConfig({ ...config, phone: e.target.value })} className={input} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Email</label><input type="email" disabled={!canEdit} value={config.email} onChange={e => setConfig({ ...config, email: e.target.value })} className={input} /></div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Moneda</label>
            {canEdit
              ? <CurrencySelect value={config.currency} onChange={code => { setConfig({ ...config, currency: code }); setConfirmCurrencyPrompt(false) }} />
              : <input disabled value={config.currency} className={input} />}
          </div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Impuesto (%)</label><input type="number" step="0.01" min="0" max="100" disabled={!canEdit} value={config.tax_rate} onChange={e => setConfig({ ...config, tax_rate: parseFloat(e.target.value) || 0 })} className={`${input} tabular-nums`} /></div>
          <div><label className="block text-xs font-medium text-slate-600 mb-1">Prefijo Factura</label><input disabled={!canEdit} value={config.invoice_prefix} onChange={e => setConfig({ ...config, invoice_prefix: e.target.value })} className={input} /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cómo se aplica el impuesto</label>
          <select disabled={!canEdit} value={taxMode} onChange={e => setTaxMode(e.target.value as TaxMode)} className={input}>
            <option value="none">Sin impuesto (el total es el precio)</option>
            <option value="incluido">Precios con impuesto incluido (se muestra el desglose)</option>
            <option value="adicional">Impuesto adicional (se suma al precio)</option>
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Usa el porcentaje de "Impuesto (%)". Cada venta y cotización guarda el impuesto de ese momento; cambiar esto no modifica las anteriores. Las ventas hechas sin señal usan la configuración vigente cuando se envían.</p>
        </div>
        {fxReady && (
          <div className="border-t border-slate-100 pt-4">
            <label className="block text-xs font-medium text-slate-600 mb-1">Tasas de cambio (cobros en otra moneda)</label>
            <p className="text-[11px] text-slate-400 mb-2">
              Tu negocio trabaja en {baseCur}. Si un cliente paga con otra moneda, la venta propone la tasa que guardes aquí y puedes corregirla en el momento.
              Escribe cuánto vale <b>1 unidad</b> de la otra moneda en {baseCur}. Actualízalas cuando cambien.
            </p>
            <div className="space-y-2">
              {fxRows.map((r, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2">
                    <select disabled={!canEdit} value={r.code} onChange={e => setFxRows(rows => rows.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} className="w-28 px-2 py-2 rounded-lg border border-slate-300 text-sm bg-white disabled:bg-slate-50">
                      {CURRENCIES.filter(c => c.code !== baseCur).map(c => <option key={c.code} value={c.code}>{c.code}</option>)}
                    </select>
                    <span className="text-xs text-slate-500 shrink-0">1 {r.code} =</span>
                    <input disabled={!canEdit} inputMode="decimal" value={r.rate} onChange={e => setFxRows(rows => rows.map((x, j) => j === i ? { ...x, rate: e.target.value } : x))} placeholder="0" className={`${input} tabular-nums`} />
                    <span className="text-xs text-slate-500 shrink-0">{baseCur}</span>
                    {canEdit && <button type="button" onClick={() => setFxRows(rows => rows.filter((_, j) => j !== i))} className="p-1.5 text-slate-400 hover:text-red-600" aria-label="Quitar"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                  {parseRate(r.rate) > 0 && <p className="text-[11px] text-slate-400 mt-0.5 ml-1 tabular-nums">Ejemplo: 1 {r.code} = {formatMoney(parseRate(r.rate), baseCur)}</p>}
                </div>
              ))}
              {fxRows.length === 0 && <p className="text-xs text-slate-400">Aún no has guardado tasas. Puedes digitarlas directamente en cada venta.</p>}
            </div>
            {canEdit && (
              <button type="button" onClick={() => setFxRows(rows => [...rows, { code: nextCode, rate: '' }])} className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50">
                <Plus className="w-3.5 h-3.5" /> Agregar moneda
              </button>
            )}
          </div>
        )}
        <div><label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label><textarea disabled={!canEdit} value={config.address} onChange={e => setConfig({ ...config, address: e.target.value })} className={input} rows={2} /></div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Ubicación en las ventas (GPS)</label>
          <select disabled={!canEdit} value={config.geo_mode ?? 'off'} onChange={e => setConfig({ ...config, geo_mode: e.target.value as 'off' | 'vendedores' | 'todos' })} className={input}>
            <option value="off">Desactivada</option>
            <option value="vendedores">Solo vendedores</option>
            <option value="todos">Todos los que registran ventas</option>
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Al registrar una venta se pide la ubicación y se pregunta si está en el establecimiento del cliente. Solo el dueño y el administrador pueden ver estos datos. Informa a tu equipo que se registra su ubicación en cada venta.</p>
        </div>

        {confirmCurrencyPrompt && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3.5 space-y-2.5">
            <div className="flex items-start gap-2 text-xs text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                Vas a cambiar la moneda base de <strong>{origCurrency}</strong> a <strong>{baseCur}</strong>. Las ventas, compras y movimientos ya registrados <strong>no se reconvierten</strong>: sus montos numéricos permanecen iguales y pasarán a mostrarse en {baseCur}.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfig(c => (c ? { ...c, currency: origCurrency } : c))
                  setConfirmCurrencyPrompt(false)
                }}
                className="px-3 py-1.5 rounded-lg border border-amber-300 bg-white text-xs font-medium text-slate-700"
              >
                Mantener {origCurrency}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void persistSettings(true)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
              >
                Confirmar cambio a {baseCur}
              </button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">{error}</p>}
        {saved && <p className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg">Configuración guardada</p>}
        {canEdit && !confirmCurrencyPrompt && (
          <button type="submit" disabled={saving} className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"><Save className="w-4 h-4" /> {saving ? 'Guardando...' : 'Guardar'}</button>
        )}
      </form>

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg mt-5 space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-emerald-700" />
          <h2 className="text-sm font-bold text-slate-800">
            Identidad Corporativa, Enlace Propio y Estudio de WhatsApp
          </h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Configura el <strong>logo oficial</strong>, el <strong>enlace propio /tienda/...</strong> que muestra la identidad de tu empresa al compartirlo en WhatsApp (sin reemplazar el enlace raíz de InventarioPro), las <strong>plantillas personalizadas de mensajes</strong> y las cuentas de <strong>Pago Móvil, Nequi, Zelle y Transferencia</strong>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBrandTab('brand')
              setBrandOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 whitespace-nowrap"
          >
            <Palette className="w-3.5 h-3.5" /> Logo, Color y Pagos
          </button>
          <button
            type="button"
            onClick={() => {
              setBrandTab('whatsapp')
              setBrandOpen(true)
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 whitespace-nowrap"
          >
            <MessageCircle className="w-3.5 h-3.5 text-emerald-700" /> Enlace Propio y WhatsApp
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg mt-5 space-y-3">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-slate-600" />
          <h2 className="text-sm font-bold text-slate-800">
            Actualización SQL en Supabase (Presupuesto, Imágenes y Catálogo)
          </h2>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Obtén en un clic el paquete SQL consolidado e idempotente para activar o actualizar las tablas del{' '}
          <strong>Presupuesto Maestro</strong>, <strong>Órdenes de Compra</strong>,{' '}
          <strong>Bucket de Imágenes Reales (`product-images`)</strong>, <strong>Ventas por Catálogo (`catalog_orders`)</strong> y <strong>Enlace Propio + WhatsApp</strong> en tu proyecto Supabase.
        </p>
        <button
          type="button"
          onClick={() => setSqlOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 whitespace-nowrap"
        >
          <Database className="w-3.5 h-3.5" /> Ver / Copiar Scripts SQL
        </button>
      </div>

      <CatalogBrandModal
        open={brandOpen}
        initialTab={brandTab}
        onClose={() => setBrandOpen(false)}
        onSaved={() => void load()}
      />
      <SqlActivationModal open={sqlOpen} onClose={() => setSqlOpen(false)} />
    </div>
  )
}
