import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth, isReadOnly, canManageInventory } from '../lib/auth'
import { useCurrency } from '../lib/currency'
import { downloadCsv, parseCsv } from '../lib/csv'
import type { Product, Category, ProductVariant } from '../types'
import BarcodeScanner from '../components/BarcodeScanner'
import ProductImageCapture, { ProductPhotoLightbox, ProductThumb } from '../components/ProductImageCapture'
import SqlActivationModal from '../components/SqlActivationModal'
import CatalogBrandModal from '../components/CatalogBrandModal'
import {
  normalizeProductVariants,
  VARIANT_PRESET_TEMPLATES,
} from '../lib/catalogCommerce'
import {
  hydrateProductsWithImages,
  saveProductImageInSupabase,
  ProductImagePersistenceError,
} from '../lib/productImages'
import {
  Plus,
  X,
  Search,
  Pencil,
  Trash2,
  Lock,
  SlidersHorizontal,
  Camera,
  Download,
  Upload,
  FileSpreadsheet,
  Percent,
  Globe,
  Copy,
  Check,
  ExternalLink,
  MessageCircle,
  BookOpen,
  Eye,
  LayoutGrid,
  List,
  Database,
  AlertTriangle,
  Palette,
  ClipboardCheck,
} from 'lucide-react'

const EMPTY_FORM = {
  name: '',
  sku: '',
  category_id: '',
  price: '0',
  price_wholesale: '',
  wholesale_min_qty: '',
  cost: '0',
  stock: '0',
  min_stock: '5',
  unit: 'unidad',
  tracks_expiry: false,
  image_url: null as string | null,
  description: '',
  featured: false,
  catalog_visible: true,
  variant_group_label: '',
  variants: [] as ProductVariant[],
}

type ImportRow = {
  sku: string
  name: string
  categoryName: string
  price: number
  priceWholesale: number | null
  wholesaleMinQty: number | null
  cost: number
  initialStock: number
  minStock: number
  unit: string
  existingId: string | null
}

type RoundMode = '2dec' | 'int' | '100'

function parseNum(v: string | undefined, fallback = 0): number {
  if (!v) return fallback
  const normalized = v.replace(/\s/g, '').replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : fallback
}

function applyRounding(val: number, mode: RoundMode): number {
  if (mode === 'int') return Math.round(val)
  if (mode === '100') return Math.round(val / 100) * 100
  return Math.round(val * 100) / 100
}

export default function Products({
  onPreviewCatalog,
  onNavigate,
}: {
  onPreviewCatalog?: (companyId: string) => void
  onNavigate?: (page: string) => void
} = {}) {
  const { user } = useAuth()
  const { fmt: money } = useCurrency()
  const noPermission = !canManageInventory(user?.role)
  const readOnly = isReadOnly(user) || noPermission

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [previewProduct, setPreviewProduct] = useState<Product | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')

  const [adjusting, setAdjusting] = useState<Product | null>(null)
  const [newStock, setNewStock] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjError, setAdjError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState('')
  const [warnNotice, setWarnNotice] = useState('')
  const [imageSchemaMissing, setImageSchemaMissing] = useState(false)
  const [sqlModalOpen, setSqlModalOpen] = useState(false)
  const [brandModalOpen, setBrandModalOpen] = useState(false)

  // Importación masiva CSV / Excel
  const [showImport, setShowImport] = useState(false)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)

  // Actualizador masivo de precios
  const [showBulkPrice, setShowBulkPrice] = useState(false)
  const [bulkCategory, setBulkCategory] = useState('')
  const [bulkMode, setBulkMode] = useState<'percent' | 'margin'>('percent')
  const [bulkPct, setBulkPct] = useState('10')
  const [bulkWholesale, setBulkWholesale] = useState(true)
  const [bulkRound, setBulkRound] = useState<RoundMode>('2dec')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState('')

  // Catálogo digital público
  const [showCatalogModal, setShowCatalogModal] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogSaving, setCatalogSaving] = useState(false)
  const [catalogCompanyId, setCatalogCompanyId] = useState<string>('')
  const [catalogCompanyName, setCatalogCompanyName] = useState<string>('Mi Empresa')
  const [catalogEnabled, setCatalogEnabled] = useState(true)
  const [catalogShowWholesale, setCatalogShowWholesale] = useState(true)
  const [catalogShowStock, setCatalogShowStock] = useState(true)
  const [catalogWelcome, setCatalogWelcome] = useState('')
  const [catalogCopied, setCatalogCopied] = useState(false)
  const [catalogFeedback, setCatalogFeedback] = useState('')

  useEffect(() => {
    void load()
  }, [])

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice(''), 6500)
  }

  function flashWarn(msg: string) {
    setWarnNotice(msg)
    window.setTimeout(() => setWarnNotice(''), 9000)
  }

  async function load() {
    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    const hydrated = await hydrateProductsWithImages((prods || []) as Product[])
    setProducts(hydrated.products)
    setImageSchemaMissing(hydrated.schemaStatus === 'missing_sql')
    setCategories((cats || []) as Category[])
  }

  /** Crea un código nuevo que no se repita con ningún SKU existente. */
  function generateSku() {
    const used = new Set(products.map(p => (p.sku || '').trim().toLowerCase()))
    let code = ''
    do {
      code = String(Math.floor(10000000 + Math.random() * 90000000))
    } while (used.has(code))
    setForm(f => ({ ...f, sku: code }))
  }

  function onScanSku(code: string): string {
    const c = code.trim()
    const other = products.find(
      p => (p.sku || '').trim().toLowerCase() === c.toLowerCase() && p.id !== editing?.id
    )
    if (other) return `Ese código ya lo tiene: ${other.name}`
    setForm(f => ({ ...f, sku: c }))
    setScanning(false)
    return c
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError('')
  }

  async function syncExpiryFlag(productId: string, desired: boolean, previous: boolean) {
    if (desired === previous) return
    const { error } = await supabase.rpc('set_product_expiry', {
      p_product: productId,
      p_on: desired,
    })
    if (error && !/set_product_expiry|does not exist|schema cache/i.test(error.message || '')) {
      flashWarn('El producto se guardó, pero no se pudo cambiar el control de vencimiento: ' + error.message)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || saving) return

    setSaving(true)
    setFormError('')

    const base = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      category_id: form.category_id || null,
      price: parseFloat(form.price) || 0,
      price_wholesale: parseFloat(form.price_wholesale) > 0 ? parseFloat(form.price_wholesale) : null,
      wholesale_min_qty: parseFloat(form.wholesale_min_qty) > 0 ? parseFloat(form.wholesale_min_qty) : null,
      cost: parseFloat(form.cost) || 0,
      min_stock: parseFloat(form.min_stock) || 0,
      unit: form.unit.trim() || 'unidad',
    }

    const withPhoto = {
      ...base,
      image_url: form.image_url || null,
    }

    const withCommercial = {
      ...withPhoto,
      description: form.description.trim() || null,
      featured: Boolean(form.featured),
      catalog_visible: form.catalog_visible !== false,
    }

    const cleanedVariants = normalizeProductVariants(form.variants)
    const withVariants = {
      ...withCommercial,
      variant_group_label: form.variant_group_label.trim() || null,
      variants: cleanedVariants,
    }

    let photoColumnMissing = false

    if (editing) {
      let { error } = await supabase.from('products').update(withVariants).eq('id', editing.id)

      if (error && /variant_group_label|variants|column|schema cache/i.test(error.message || '')) {
        const retryCommercial = await supabase.from('products').update(withCommercial).eq('id', editing.id)
        error = retryCommercial.error
      }

      if (error && /description|featured|catalog_visible|column|schema cache/i.test(error.message || '')) {
        const retryPhoto = await supabase.from('products').update(withPhoto).eq('id', editing.id)
        error = retryPhoto.error
        if (error && /image_url|column|schema cache/i.test(error.message || '')) {
          photoColumnMissing = Boolean(form.image_url)
          const retryBase = await supabase.from('products').update(base).eq('id', editing.id)
          error = retryBase.error
        }
      }

      if (error) {
        setSaving(false)
        setFormError('Error al guardar: ' + error.message)
        return
      }

      await syncExpiryFlag(editing.id, form.tracks_expiry, Boolean(editing.tracks_expiry))

      const photoChanged = (form.image_url || null) !== (editing.image_url || null)
      if (photoChanged || form.image_url) {
        try {
          await saveProductImageInSupabase({
            productId: editing.id,
            companyId: user?.company_id || null,
            skuOrName: form.sku || form.name,
            imageUrl: form.image_url || null,
          })
          photoColumnMissing = false
        } catch (imgErr) {
          if (imgErr instanceof ProductImagePersistenceError && imgErr.needsSqlActivation) {
            photoColumnMissing = true
            setImageSchemaMissing(true)
          }
        }
      }
    } else {
      let { data, error } = await supabase
        .from('products')
        .insert({ ...withVariants, stock: 0 })
        .select('id')
        .single()

      if (error && /variant_group_label|variants|column|schema cache/i.test(error.message || '')) {
        const retryCommercial = await supabase
          .from('products')
          .insert({ ...withCommercial, stock: 0 })
          .select('id')
          .single()
        data = retryCommercial.data
        error = retryCommercial.error
      }

      if (error && /description|featured|catalog_visible|column|schema cache/i.test(error.message || '')) {
        const retryPhoto = await supabase
          .from('products')
          .insert({ ...withPhoto, stock: 0 })
          .select('id')
          .single()
        data = retryPhoto.data
        error = retryPhoto.error

        if (error && /image_url|column|schema cache/i.test(error.message || '')) {
          photoColumnMissing = Boolean(form.image_url)
          const retryBase = await supabase
            .from('products')
            .insert({ ...base, stock: 0 })
            .select('id')
            .single()
          data = retryBase.data
          error = retryBase.error
        }
      }

      if (error || !data) {
        setSaving(false)
        setFormError('Error: ' + (error?.message ?? 'No se pudo crear el producto'))
        return
      }

      if (form.image_url) {
        try {
          await saveProductImageInSupabase({
            productId: data.id,
            companyId: user?.company_id || null,
            skuOrName: form.sku || form.name,
            imageUrl: form.image_url,
          })
          photoColumnMissing = false
        } catch (imgErr) {
          if (imgErr instanceof ProductImagePersistenceError && imgErr.needsSqlActivation) {
            photoColumnMissing = true
            setImageSchemaMissing(true)
          }
        }
      }

      if (form.tracks_expiry) {
        await syncExpiryFlag(data.id, true, false)
      }

      const initial = parseFloat(form.stock) || 0
      if (initial > 0) {
        const { error: e2 } = await supabase.rpc('ajustar_stock', {
          p_product_id: data.id,
          p_new_stock: initial,
          p_reason: 'Stock inicial',
        })
        if (e2) {
          flashWarn('El producto se creó, pero no se pudo registrar el stock inicial: ' + e2.message)
        }
      }
    }

    setSaving(false)
    closeForm()
    await load()
    if (photoColumnMissing) {
      flashWarn(
        'El producto se guardó, pero falta activar la tabla de imágenes (product_images) en Supabase para almacenar fotografías permanentemente.'
      )
      setSqlModalOpen(true)
    } else {
      flash(editing ? 'Producto actualizado correctamente.' : 'Producto creado correctamente.')
    }
  }

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault()
    if (readOnly || !adjusting || saving) return

    setSaving(true)
    setAdjError('')

    const { error } = await supabase.rpc('ajustar_stock', {
      p_product_id: adjusting.id,
      p_new_stock: parseFloat(newStock),
      p_reason: adjReason,
    })

    setSaving(false)

    if (error) {
      setAdjError('Error al ajustar: ' + error.message)
      return
    }

    setAdjusting(null)
    setNewStock('')
    setAdjReason('')
    flash('Stock ajustado en Kardex.')
    void load()
  }

  async function executeDelete() {
    if (readOnly || !confirmDelete || deleting) return
    setDeleting(true)

    const { error } = await supabase.from('products').delete().eq('id', confirmDelete.id)
    setDeleting(false)

    if (error) {
      setConfirmDelete(null)
      if (/foreign key|23503|restrict/i.test(error.message || '')) {
        flashWarn('No se puede eliminar este producto porque ya tiene ventas, compras o movimientos en el Kardex.')
      } else {
        flashWarn('No se pudo eliminar: ' + error.message)
      }
      return
    }

    setConfirmDelete(null)
    flash('Producto eliminado.')
    void load()
  }

  function edit(p: Product) {
    if (readOnly) return
    setFormError('')
    setEditing(p)
    setForm({
      name: p.name,
      sku: p.sku,
      category_id: p.category_id || '',
      price: String(p.price),
      price_wholesale: p.price_wholesale ? String(p.price_wholesale) : '',
      wholesale_min_qty: p.wholesale_min_qty ? String(p.wholesale_min_qty) : '',
      cost: String(p.cost),
      stock: String(p.stock),
      min_stock: String(p.min_stock),
      unit: p.unit,
      tracks_expiry: Boolean(p.tracks_expiry),
      image_url: p.image_url || null,
      description: p.description || '',
      featured: Boolean(p.featured),
      catalog_visible: p.catalog_visible !== false,
      variant_group_label: p.variant_group_label || '',
      variants: normalizeProductVariants(p.variants),
    })
    setShowForm(true)
  }

  async function quickUpdateProductPhoto(product: Product, nextUrl: string | null) {
    if (readOnly) return
    const { savedUrl } = await saveProductImageInSupabase({
      productId: product.id,
      companyId: user?.company_id || null,
      skuOrName: product.sku || product.name,
      imageUrl: nextUrl,
    })
    setImageSchemaMissing(false)
    setProducts(prev => prev.map(p => (p.id === product.id ? { ...p, image_url: savedUrl } : p)))
    setPreviewProduct(prev => (prev && prev.id === product.id ? { ...prev, image_url: savedUrl } : prev))
    flash(
      savedUrl
        ? `Fotografía guardada en Supabase para ${product.name}.`
        : `Fotografía eliminada de ${product.name}.`
    )
  }

  function openAdjust(p: Product) {
    if (readOnly) return
    setAdjError('')
    setAdjusting(p)
    setNewStock(String(p.stock))
    setAdjReason('')
  }

  function exportExcel() {
    if (products.length === 0) return
    const catMap = new Map(categories.map(c => [c.id, c.name]))
    downloadCsv(
      `catalogo_productos_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'SKU',
        'Nombre',
        'Categoría',
        'Precio detal',
        'Precio mayor',
        'Mayor desde',
        'Costo',
        'Stock actual',
        'Stock mínimo',
        'Unidad',
        'Controla vencimiento',
        'Valor inventario',
      ],
      products.map(p => [
        p.sku,
        p.name,
        p.category_id ? catMap.get(p.category_id) || '' : '',
        p.price,
        p.price_wholesale ?? '',
        p.wholesale_min_qty ?? '',
        p.cost,
        p.stock,
        p.min_stock,
        p.unit,
        p.tracks_expiry ? 'Sí' : 'No',
        Math.round(Number(p.stock) * Number(p.cost) * 100) / 100,
      ])
    )
  }

  function downloadTemplate() {
    downloadCsv(
      'plantilla_productos.csv',
      ['sku', 'nombre', 'categoria', 'precio', 'precio_mayor', 'cantidad_mayor', 'costo', 'stock_inicial', 'stock_minimo', 'unidad'],
      [
        ['PROD-001', 'Arroz Premium 1kg', 'Alimentos', 1.5, 1.35, 12, 1.05, 24, 5, 'unidad'],
        ['PROD-002', 'Aceite Vegetal 1L', 'Alimentos', 2.8, 2.55, 6, 2.1, 12, 4, 'unidad'],
      ]
    )
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      const parsed = parseCsv(text)
      if (parsed.length === 0) {
        setImportRows([])
        setImportError('El archivo está vacío o no tiene encabezados válidos.')
        return
      }
      const skuMap = new Map(products.map(p => [(p.sku || '').trim().toLowerCase(), p.id]))
      const rows: ImportRow[] = []

      for (const r of parsed) {
        const name = (r.nombre || r.name || r.producto || '').trim()
        const sku = (r.sku || r.codigo || r.codigo_de_barras || '').trim()
        if (!name || !sku) continue

        const price = Math.max(0, parseNum(r.precio || r.precio_detal || r.price, 0))
        const pw = parseNum(r.precio_mayor || r.por_mayor || r.price_wholesale, 0)
        const qw = parseNum(r.cantidad_mayor || r.mayor_desde || r.wholesale_min_qty, 0)
        const cost = Math.max(0, parseNum(r.costo || r.cost, 0))
        const initialStock = Math.max(0, parseNum(r.stock_inicial || r.stock_actual || r.stock, 0))
        const minStock = Math.max(0, parseNum(r.stock_minimo || r.min_stock || r.minimo, 5))
        const unit = (r.unidad || r.unit || 'unidad').trim() || 'unidad'
        const categoryName = (r.categoria || r.category || '').trim()

        rows.push({
          sku,
          name,
          categoryName,
          price,
          priceWholesale: pw > 0 ? pw : null,
          wholesaleMinQty: qw > 0 ? qw : null,
          cost,
          initialStock,
          minStock,
          unit,
          existingId: skuMap.get(sku.toLowerCase()) || null,
        })
      }

      if (rows.length === 0) {
        setImportRows([])
        setImportError('No se encontraron filas con "sku" y "nombre". Descarga la plantilla de ejemplo para ver las columnas.')
        return
      }
      setImportRows(rows)
    }
    reader.readAsText(file, 'utf-8')
  }

  async function runImport() {
    if (readOnly || importing || importRows.length === 0) return
    setImporting(true)
    setImportError('')

    const catByName = new Map(categories.map(c => [c.name.trim().toLowerCase(), c.id]))
    let created = 0
    let updated = 0
    let failed = 0

    for (const r of importRows) {
      const category_id = r.categoryName ? catByName.get(r.categoryName.toLowerCase()) || null : null
      const payload = {
        name: r.name,
        sku: r.sku,
        category_id,
        price: r.price,
        price_wholesale: r.priceWholesale,
        wholesale_min_qty: r.wholesaleMinQty,
        cost: r.cost,
        min_stock: r.minStock,
        unit: r.unit,
      }

      if (r.existingId) {
        const { error } = await supabase.from('products').update(payload).eq('id', r.existingId)
        if (error) failed++
        else updated++
      } else {
        const { data, error } = await supabase.from('products').insert({ ...payload, stock: 0 }).select('id').single()
        if (error || !data) {
          failed++
        } else {
          created++
          if (r.initialStock > 0) {
            await supabase.rpc('ajustar_stock', {
              p_product_id: data.id,
              p_new_stock: r.initialStock,
              p_reason: 'Carga inicial desde CSV',
            })
          }
        }
      }
    }

    setImporting(false)
    setShowImport(false)
    setImportRows([])
    await load()
    flash(
      `Importación finalizada: ${created} creado(s), ${updated} actualizado(s)` +
        (failed > 0 ? `, ${failed} con error.` : '.')
    )
  }

  // Vista previa del actualizador masivo de precios
  const bulkPctNum = parseFloat(bulkPct)
  const bulkPreview = useMemo(() => {
    if (!Number.isFinite(bulkPctNum)) return []
    if (bulkMode === 'percent' && (bulkPctNum <= -99 || bulkPctNum > 500 || bulkPctNum === 0)) return []
    if (bulkMode === 'margin' && (bulkPctNum < 0 || bulkPctNum > 1000)) return []

    const candidates = products.filter(p => !bulkCategory || p.category_id === bulkCategory)
    const out: {
      id: string
      name: string
      oldPrice: number
      newPrice: number
      oldWholesale: number | null
      newWholesale: number | null
    }[] = []

    for (const p of candidates) {
      let np = 0
      let nw: number | null = p.price_wholesale ?? null

      if (bulkMode === 'percent') {
        np = (Number(p.price) || 0) * (1 + bulkPctNum / 100)
        if (bulkWholesale && nw && nw > 0) {
          nw = applyRounding(nw * (1 + bulkPctNum / 100), bulkRound)
        }
      } else {
        const cost = Number(p.cost) || 0
        if (cost <= 0) continue
        np = cost * (1 + bulkPctNum / 100)
        if (bulkWholesale && nw && nw > 0 && Number(p.price) > 0) {
          nw = applyRounding(np * (nw / Number(p.price)), bulkRound)
        }
      }

      np = applyRounding(np, bulkRound)
      if (np > 0) {
        out.push({
          id: p.id,
          name: p.name,
          oldPrice: Number(p.price) || 0,
          newPrice: np,
          oldWholesale: p.price_wholesale ?? null,
          newWholesale: nw,
        })
      }
    }
    return out
  }, [products, bulkCategory, bulkMode, bulkPctNum, bulkWholesale, bulkRound])

  async function applyBulkPrices() {
    if (readOnly || bulkSaving || bulkPreview.length === 0) return
    setBulkSaving(true)
    setBulkError('')

    const { data, error } = await supabase.rpc('actualizar_precios_masivo', {
      p_category_id: bulkCategory || null,
      p_mode: bulkMode,
      p_pct: bulkPctNum,
      p_apply_wholesale: bulkWholesale,
      p_round_mode: bulkRound,
    })

    if (error) {
      if (/actualizar_precios_masivo|does not exist|schema cache/i.test(error.message || '')) {
        // Respaldo directo para que funcione incluso antes de ejecutar la migración SQL
        let updatedCount = 0
        for (const item of bulkPreview) {
          const { error: uErr } = await supabase
            .from('products')
            .update({
              price: item.newPrice,
              price_wholesale: item.newWholesale,
            })
            .eq('id', item.id)
          if (!uErr) updatedCount++
        }
        setBulkSaving(false)
        setShowBulkPrice(false)
        await load()
        flash(`Precios actualizados en ${updatedCount} producto(s).`)
        return
      }
      setBulkSaving(false)
      setBulkError(error.message)
      return
    }

    const count = Number((data as { updated?: number } | null)?.updated ?? bulkPreview.length)
    setBulkSaving(false)
    setShowBulkPrice(false)
    await load()
    flash(`Precios actualizados en ${count} producto(s).`)
  }

  // Catálogo Digital Público
  async function openCatalogModal() {
    setShowCatalogModal(true)
    setCatalogLoading(true)
    setCatalogFeedback('')
    setCatalogCopied(false)

    const { data, error } = await supabase.rpc('obtener_mi_empresa_catalogo')
    if (!error && data) {
      const info = data as {
        company_id: string
        name: string
        catalog_enabled: boolean
        catalog_show_wholesale: boolean
        catalog_show_stock: boolean
        catalog_welcome: string | null
      }
      setCatalogCompanyId(info.company_id || user?.company_id || '')
      setCatalogCompanyName(info.name || user?.company_name || 'Mi Empresa')
      setCatalogEnabled(Boolean(info.catalog_enabled))
      setCatalogShowWholesale(Boolean(info.catalog_show_wholesale))
      setCatalogShowStock(Boolean(info.catalog_show_stock))
      setCatalogWelcome(info.catalog_welcome || '')
      setCatalogLoading(false)
      return
    }

    // Respaldo si aún no se ejecutó el SQL nuevo
    const { data: cfgRows } = await supabase.from('company_config').select('*').limit(1)
    const cfg = (cfgRows || [])[0] as Record<string, unknown> | undefined
    setCatalogCompanyId(String(cfg?.company_id || user?.company_id || ''))
    setCatalogCompanyName(String(cfg?.name || user?.company_name || 'Mi Empresa'))
    setCatalogEnabled(cfg?.catalog_enabled !== false)
    setCatalogShowWholesale(cfg?.catalog_show_wholesale !== false)
    setCatalogShowStock(cfg?.catalog_show_stock !== false)
    setCatalogWelcome(typeof cfg?.catalog_welcome === 'string' ? cfg.catalog_welcome : '')
    if (error && /obtener_mi_empresa_catalogo|does not exist|schema cache/i.test(error.message || '')) {
      setCatalogFeedback(
        'Ejecuta en Supabase el script SQL 20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql para activar los pedidos públicos sin inicio de sesión.'
      )
    }
    setCatalogLoading(false)
  }

  async function saveCatalogSettings() {
    if (readOnly || catalogSaving) return
    setCatalogSaving(true)
    setCatalogFeedback('')
    const { error } = await supabase.rpc('guardar_ajustes_catalogo', {
      p_enabled: catalogEnabled,
      p_show_wholesale: catalogShowWholesale,
      p_show_stock: catalogShowStock,
      p_welcome: catalogWelcome.trim() || null,
    })
    setCatalogSaving(false)
    if (error) {
      setCatalogFeedback(
        /guardar_ajustes_catalogo|does not exist|schema cache/i.test(error.message || '')
          ? 'Para guardar estos ajustes y habilitar el catálogo público ejecuta el SQL 20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql en Supabase.'
          : error.message
      )
      return
    }
    setCatalogFeedback('Configuración del catálogo guardada.')
  }

  const catalogUrl = catalogCompanyId
    ? `${window.location.origin}/?catalogo=${encodeURIComponent(catalogCompanyId)}`
    : ''

  async function copyCatalogUrl() {
    if (!catalogUrl) return
    try {
      await navigator.clipboard.writeText(catalogUrl)
      setCatalogCopied(true)
      window.setTimeout(() => setCatalogCopied(false), 2500)
    } catch {
      setCatalogFeedback('Copia manualmente el enlace mostrado arriba.')
    }
  }

  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c.name])), [categories])

  const filtered = useMemo(
    () =>
      products.filter(
        p =>
          (!categoryFilter || p.category_id === categoryFilter) &&
          (p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.sku.toLowerCase().includes(search.toLowerCase()))
      ),
    [products, categoryFilter, search]
  )

  const diff = adjusting ? (parseFloat(newStock) || 0) - adjusting.stock : 0
  const newCount = importRows.filter(r => !r.existingId).length
  const updateCount = importRows.filter(r => r.existingId).length

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-6 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Productos</h1>
          <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {products.length} referencia(s) en catálogo
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('catalog')}
              className="flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 whitespace-nowrap"
            >
              <BookOpen className="w-4 h-4" /> Catálogo PDF / WhatsApp
            </button>
          )}

          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('catorders')}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <ClipboardCheck className="w-4 h-4 text-slate-600" /> Pedidos web
            </button>
          )}

          <button
            type="button"
            onClick={() => setBrandModalOpen(true)}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            <Palette className="w-4 h-4 text-slate-600" /> Identidad y Pagos
          </button>

          <button
            type="button"
            onClick={() => void openCatalogModal()}
            className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
          >
            <Globe className="w-4 h-4 text-slate-600" /> Enlace público
          </button>

          {!readOnly && products.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBulkError('')
                setShowBulkPrice(true)
              }}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <Percent className="w-4 h-4 text-slate-600" /> Ajustar precios
            </button>
          )}

          {products.length > 0 && (
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-4 h-4" /> Exportar Excel
            </button>
          )}

          {!readOnly && (
            <button
              onClick={() => {
                setImportRows([])
                setImportError('')
                setShowImport(true)
              }}
              className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 whitespace-nowrap"
            >
              <Upload className="w-4 h-4" /> Importar CSV
            </button>
          )}

          <button
            onClick={() => {
              if (readOnly) return
              setEditing(null)
              setForm(EMPTY_FORM)
              setFormError('')
              setShowForm(true)
            }}
            disabled={readOnly}
            className="flex items-center gap-2 bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Nuevo
          </button>
        </div>
      </div>

      {readOnly && (
        <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          {noPermission
            ? 'Solo el dueño o el administrador pueden crear, editar o eliminar productos.'
            : 'Modo de solo lectura. Activa tu suscripción para crear, editar o eliminar productos.'}
        </div>
      )}

      {imageSchemaMissing && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-amber-900 bg-amber-50 border border-amber-300 rounded-xl px-3.5 py-2.5 mb-4 text-xs">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <span>
              <strong>Tabla de imágenes pendiente en Supabase:</strong> ejecuta el script SQL de{' '}
              <code className="font-mono">product_images</code> para almacenar las fotografías reales permanentemente.
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

      {notice && (
        <div className="text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {notice}
        </div>
      )}

      {warnNotice && (
        <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-xs">
          {warnNotice}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre o código SKU..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white sm:w-52"
          >
            <option value="">Todas las categorías</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 self-start sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => setViewMode('table')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              viewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <List className="w-3.5 h-3.5" /> Tabla
          </button>
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap ${
              viewMode === 'cards' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> Tarjetas con foto
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => (
            <div
              key={p.id}
              className="bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col"
            >
              <div className="relative bg-white border-b border-slate-100">
                <button
                  type="button"
                  onClick={() => setPreviewProduct(p)}
                  className="w-full block text-left focus:outline-none"
                >
                  <ProductThumb src={p.image_url} name={p.name} size="card" fit="contain" className="border-0 rounded-none" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewProduct(p)}
                  title="Ver o cambiar fotografía real"
                  className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/95 hover:bg-slate-900 text-slate-700 hover:text-white border border-slate-200/80 text-[11px] font-medium shadow-sm transition-colors"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{p.image_url ? 'Ver foto' : 'Subir foto'}</span>
                </button>
                {p.featured && (
                  <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-slate-900 text-white text-[11px] font-medium">
                    Destacado
                  </span>
                )}
              </div>
              <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                <div>
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="truncate">
                      {(p.category_id && catMap.get(p.category_id)) || 'Sin categoría'}
                    </span>
                    <span className="font-mono tabular-nums shrink-0">{p.sku}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5 leading-snug">{p.name}</p>
                  {p.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mt-1">{p.description}</p>
                  )}
                  {Array.isArray(p.variants) && p.variants.length > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1 truncate">
                      {p.variant_group_label || 'Presentaciones'}:{' '}
                      <span className="font-medium text-slate-700">
                        {p.variants.map(v => v.label).join(' · ')}
                      </span>
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex items-baseline justify-between gap-2 tabular-nums">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{money(p.price)}</p>
                      {p.price_wholesale ? (
                        <p className="text-[11px] text-emerald-700">
                          Mayor {money(p.price_wholesale)}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        p.stock < p.min_stock ? 'text-red-600' : 'text-slate-600'
                      }`}
                    >
                      Stock: {p.stock}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-1 pt-2 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => openAdjust(p)}
                      disabled={readOnly}
                      title="Ajustar stock"
                      className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => edit(p)}
                      disabled={readOnly}
                      title="Editar"
                      className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30"
                    >
                      <Pencil className="w-3.5 h-3.5 text-slate-500" />
                    </button>
                    <button
                      type="button"
                      onClick={() => !readOnly && setConfirmDelete(p)}
                      disabled={readOnly}
                      title="Eliminar"
                      className="p-1.5 rounded hover:bg-red-50 disabled:opacity-30"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-400">
              No hay productos
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Producto</th>
                <th className="text-left px-4 py-3 font-medium">SKU</th>
                <th className="text-left px-4 py-3 font-medium">Precio detal</th>
                <th className="text-left px-4 py-3 font-medium">Por mayor</th>
                <th className="text-left px-4 py-3 font-medium">Costo</th>
                <th className="text-left px-4 py-3 font-medium">Stock</th>
                <th className="text-left px-4 py-3 font-medium">Min</th>
                <th className="text-left px-4 py-3 font-medium">Acciones</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(p)}
                        title="Ver o actualizar fotografía real"
                        className="relative group shrink-0 rounded-lg overflow-hidden focus:outline-none"
                      >
                        <ProductThumb src={p.image_url} name={p.name} size="sm" fit="contain" />
                        <span className="absolute inset-0 bg-slate-900/45 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="w-3.5 h-3.5" />
                        </span>
                      </button>
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 truncate">{p.name}</p>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                          {p.category_id && catMap.get(p.category_id) && (
                            <span>{catMap.get(p.category_id)}</span>
                          )}
                          {p.featured && <span className="text-emerald-700 font-medium">· Destacado</span>}
                          {p.catalog_visible === false && <span>· Oculto en catálogo</span>}
                          {p.tracks_expiry && <span>· Controla vencimiento</span>}
                          {Array.isArray(p.variants) && p.variants.length > 0 && (
                            <span className="text-slate-600">
                              · {p.variants.length} presentaciones ({p.variants.slice(0, 3).map(v => v.label).join(', ')})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500 tabular-nums">{p.sku}</td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums font-medium">
                    {money(p.price)}
                  </td>
                  <td className="px-4 py-3 text-slate-700 whitespace-nowrap tabular-nums">
                    {p.price_wholesale ? (
                      <>
                        {money(p.price_wholesale)}
                        {p.wholesale_min_qty ? (
                          <span className="block text-[11px] text-slate-400">desde {p.wholesale_min_qty} und.</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap tabular-nums">{money(p.cost)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    <span className={p.stock < p.min_stock ? 'text-red-600 font-medium' : 'text-slate-700'}>
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 tabular-nums">{p.min_stock}</td>

                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => setPreviewProduct(p)}
                        title="Ver / subir foto real"
                        className="p-1.5 rounded hover:bg-slate-100"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                      </button>

                      <button
                        onClick={() => openAdjust(p)}
                        disabled={readOnly}
                        title="Ajustar stock"
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                      </button>

                      <button
                        onClick={() => edit(p)}
                        disabled={readOnly}
                        title="Editar"
                        className="p-1.5 rounded hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Pencil className="w-3.5 h-3.5 text-slate-500" />
                      </button>

                      <button
                        onClick={() => !readOnly && setConfirmDelete(p)}
                        disabled={readOnly}
                        title="Eliminar"
                        className="p-1.5 rounded hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                    No hay productos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Crear / Editar producto */}
      {showForm && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={closeForm}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">
                {editing ? 'Editar' : 'Nuevo'} producto
              </h2>
              <button onClick={closeForm} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            {formError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {formError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Fotografía del producto</label>
                <ProductImageCapture
                  value={form.image_url}
                  name={form.name || 'Producto'}
                  companyId={user?.company_id}
                  skuOrName={form.sku || form.name}
                  onChange={url => setForm(f => ({ ...f, image_url: url }))}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nombre</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Ej: Jean azul mantequilla"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">SKU / código de barras</label>
                <div className="flex gap-2">
                  <input
                    required
                    value={form.sku}
                    onChange={e => setForm({ ...form, sku: e.target.value })}
                    placeholder="Ej: JAM-001"
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setScanning(true)}
                    title="Leer el código con la cámara"
                    className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 rounded-lg text-sm font-medium shrink-0 whitespace-nowrap"
                  >
                    <Camera className="w-4 h-4" /> Leer
                  </button>
                  <button
                    type="button"
                    onClick={generateSku}
                    title="Crear un código nuevo"
                    className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 rounded-lg text-sm font-medium shrink-0 whitespace-nowrap"
                  >
                    Generar
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Si el producto ya trae código de barras, léelo con la cámara. Si no, genera uno y luego imprime la etiqueta en el menú Etiquetas.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Categoría</label>
                <select
                  value={form.category_id}
                  onChange={e => setForm({ ...form, category_id: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  <option value="">Sin categoría</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Precio de venta</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={form.price}
                    onChange={e => setForm({ ...form, price: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Precio por mayor</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={form.price_wholesale}
                    onChange={e => setForm({ ...form, price_wholesale: e.target.value })}
                    placeholder="Opcional"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Por mayor desde (cantidad)</label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={form.wholesale_min_qty}
                    onChange={e => setForm({ ...form, wholesale_min_qty: e.target.value })}
                    placeholder="Ej: 12"
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Costo</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={form.cost}
                    onChange={e => setForm({ ...form, cost: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {editing ? 'Stock actual' : 'Stock inicial'}
                  </label>

                  {editing ? (
                    <p className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 tabular-nums">
                      {editing.stock}
                    </p>
                  ) : (
                    <input
                      required
                      type="number"
                      step="any"
                      min="0"
                      value={form.stock}
                      onChange={e => setForm({ ...form, stock: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Stock mínimo</label>
                  <input
                    required
                    type="number"
                    step="any"
                    min="0"
                    value={form.min_stock}
                    onChange={e => setForm({ ...form, min_stock: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>
              </div>

              <p className="text-[11px] text-slate-400">
                El precio por mayor se cobra a los clientes marcados «Mayor» y también cuando la cantidad llega a la indicada. Si lo dejas vacío, siempre se cobra el precio detal.
              </p>

              {editing && (
                <p className="text-[11px] text-slate-400">
                  Para cambiar el stock usa el botón «Ajustar stock» de la tabla.
                </p>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Unidad de medida</label>
                <input
                  value={form.unit}
                  onChange={e => setForm({ ...form, unit: e.target.value })}
                  placeholder="Ej: unidad, caja, kg, litro"
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              {/* Cualidades, tallas o presentaciones para el catálogo */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-slate-800">
                      Cualidades, tallas o presentaciones (opcional)
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Permite que el cliente elija tallas, mililitros, litros, gramos, kilogramos o bultos desde el catálogo web.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setForm(f => ({
                        ...f,
                        variant_group_label: f.variant_group_label || 'Presentación',
                        variants: [
                          ...f.variants,
                          {
                            id: `v-${Date.now()}-${f.variants.length}`,
                            label: '',
                            price: parseFloat(f.price) || 0,
                            price_wholesale:
                              parseFloat(f.price_wholesale) > 0
                                ? parseFloat(f.price_wholesale)
                                : null,
                            stock_multiplier: 1,
                            available: true,
                          },
                        ],
                      }))
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-500 mr-1">Plantillas:</span>
                  {VARIANT_PRESET_TEMPLATES.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() =>
                        setForm(f => ({
                          ...f,
                          variant_group_label: preset.groupLabel,
                          variants: preset.build(
                            parseFloat(f.price) || 0,
                            parseFloat(f.price_wholesale) > 0
                              ? parseFloat(f.price_wholesale)
                              : null
                          ),
                        }))
                      }
                      className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 whitespace-nowrap"
                    >
                      {preset.title}
                    </button>
                  ))}
                  {form.variants.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setForm(f => ({ ...f, variants: [] }))}
                      className="px-2 py-1 text-[11px] text-red-600 hover:underline whitespace-nowrap"
                    >
                      Limpiar todas
                    </button>
                  )}
                </div>

                {form.variants.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Título de la cualidad
                      </label>
                      <input
                        value={form.variant_group_label}
                        onChange={e => setForm(f => ({ ...f, variant_group_label: e.target.value }))}
                        placeholder="Ej: Talla, Volumen, Peso, Empaque"
                        className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                      />
                    </div>

                    <div className="grid grid-cols-12 gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 px-1">
                      <span className="col-span-4">Opción (ej. 500 ml)</span>
                      <span className="col-span-3">Detal</span>
                      <span className="col-span-2">Mayor</span>
                      <span className="col-span-2" title="Cuántas unidades base descuenta del stock">
                        Equiv. stock
                      </span>
                      <span className="col-span-1 text-right"> </span>
                    </div>

                    {form.variants.map((v, idx) => (
                      <div key={v.id || idx} className="grid grid-cols-12 gap-1.5 items-center">
                        <input
                          value={v.label}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              variants: f.variants.map((item, j) =>
                                j === idx ? { ...item, label: e.target.value } : item
                              ),
                            }))
                          }
                          placeholder="Ej: 1 kg / Talla M"
                          className="col-span-4 px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs"
                        />
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={v.price}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              variants: f.variants.map((item, j) =>
                                j === idx
                                  ? { ...item, price: parseFloat(e.target.value) || 0 }
                                  : item
                              ),
                            }))
                          }
                          className="col-span-3 px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums"
                        />
                        <input
                          type="number"
                          step="any"
                          min="0"
                          value={v.price_wholesale ?? ''}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              variants: f.variants.map((item, j) =>
                                j === idx
                                  ? {
                                      ...item,
                                      price_wholesale:
                                        parseFloat(e.target.value) > 0
                                          ? parseFloat(e.target.value)
                                          : null,
                                    }
                                  : item
                              ),
                            }))
                          }
                          placeholder="—"
                          className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums"
                        />
                        <input
                          type="number"
                          step="any"
                          min="0.001"
                          value={v.stock_multiplier ?? 1}
                          onChange={e =>
                            setForm(f => ({
                              ...f,
                              variants: f.variants.map((item, j) =>
                                j === idx
                                  ? {
                                      ...item,
                                      stock_multiplier: parseFloat(e.target.value) || 1,
                                    }
                                  : item
                              ),
                            }))
                          }
                          title="Cuántas unidades base descuenta de inventario al vender 1 de esta presentación"
                          className="col-span-2 px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-xs tabular-nums"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setForm(f => ({
                              ...f,
                              variants: f.variants.filter((_, j) => j !== idx),
                            }))
                          }
                          title="Quitar presentación"
                          className="col-span-1 p-1.5 text-slate-400 hover:text-red-600 flex justify-end"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <p className="text-[11px] text-slate-400">
                      «Equiv. stock» indica cuántas unidades base descuenta al facturar (ej. 500 g = 0.5 si tu inventario está en kg; Bulto ×20 = 20).
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Descripción comercial para el catálogo (opcional)
                </label>
                <textarea
                  rows={2}
                  maxLength={220}
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Ej: Presentación empacada al vacío, ideal para panaderías y abastos."
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.catalog_visible}
                    onChange={e => setForm({ ...form, catalog_visible: e.target.checked })}
                    className="mt-0.5 accent-slate-800"
                  />
                  <span className="text-xs text-slate-700">
                    <strong className="block font-medium text-slate-800">Visible en catálogo</strong>
                    Aparece en el PDF comercial y vitrina online.
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.featured}
                    onChange={e => setForm({ ...form, featured: e.target.checked })}
                    className="mt-0.5 accent-slate-800"
                  />
                  <span className="text-xs text-slate-700">
                    <strong className="block font-medium text-slate-800">Producto destacado</strong>
                    Prioridad al inicio del catálogo de ventas.
                  </span>
                </label>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.tracks_expiry}
                  onChange={e => setForm({ ...form, tracks_expiry: e.target.checked })}
                  className="mt-0.5 accent-slate-800"
                />
                <span className="text-xs text-slate-700">
                  <strong className="block font-medium text-slate-800">Controlar fecha de vencimiento por lotes</strong>
                  Al comprar este producto se pedirá la fecha de vencimiento, y al vender saldrá primero el lote más próximo a vencer.
                </span>
              </label>

              <button
                type="submit"
                disabled={saving}
                className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : editing ? 'Guardar cambios' : 'Crear producto'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Ajuste masivo de precios */}
      {showBulkPrice && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !bulkSaving && setShowBulkPrice(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-slate-800">Actualizador masivo de precios</h2>
              <button
                onClick={() => !bulkSaving && setShowBulkPrice(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Aumenta o reduce tus precios por porcentaje o recalcúlalos según un margen sobre el costo. Revisa la vista previa antes de aplicar.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alcance</label>
                <select
                  value={bulkCategory}
                  onChange={e => setBulkCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                >
                  <option value="">Todos los productos ({products.length})</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>
                      Categoría: {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Método de cálculo</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkMode('percent')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left ${
                      bulkMode === 'percent'
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="block font-semibold">Variación %</span>
                    <span className={bulkMode === 'percent' ? 'text-slate-300' : 'text-slate-400'}>
                      Ej: +8% o -10% sobre precio actual
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkMode('margin')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border text-left ${
                      bulkMode === 'margin'
                        ? 'bg-slate-800 text-white border-slate-800'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <span className="block font-semibold">Margen sobre costo</span>
                    <span className={bulkMode === 'margin' ? 'text-slate-300' : 'text-slate-400'}>
                      Ej: Costo + 35% de utilidad
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {bulkMode === 'percent' ? 'Porcentaje (+ o -)' : 'Margen sobre costo (%)'}
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={bulkPct}
                    onChange={e => setBulkPct(e.target.value)}
                    placeholder={bulkMode === 'percent' ? 'Ej: 10 o -5' : 'Ej: 35'}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Redondeo</label>
                  <select
                    value={bulkRound}
                    onChange={e => setBulkRound(e.target.value as RoundMode)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                  >
                    <option value="2dec">2 decimales (0.01)</option>
                    <option value="int">Entero sin centavos</option>
                    <option value="100">Múltiplo de 100</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bulkWholesale}
                  onChange={e => setBulkWholesale(e.target.checked)}
                  className="accent-slate-800"
                />
                Actualizar también los precios por mayor configurados
              </label>

              {bulkError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {bulkError}
                </div>
              )}

              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/60">
                <p className="text-xs font-semibold text-slate-800 mb-2 tabular-nums">
                  Vista previa ({bulkPreview.length} producto(s) se actualizarán)
                </p>
                {bulkPreview.length === 0 ? (
                  <p className="text-xs text-slate-400">
                    Ingresa un porcentaje distinto de cero para ver cómo quedarán los nuevos precios.
                  </p>
                ) : (
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-200/70 text-xs">
                    {bulkPreview.slice(0, 20).map(item => (
                      <div key={item.id} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="text-slate-700 truncate">{item.name}</span>
                        <span className="shrink-0 tabular-nums font-medium text-slate-800">
                          <span className="text-slate-400 line-through mr-1.5">{money(item.oldPrice)}</span>
                          {money(item.newPrice)}
                        </span>
                      </div>
                    ))}
                    {bulkPreview.length > 20 && (
                      <p className="pt-2 text-[11px] text-slate-400">
                        …y {bulkPreview.length - 20} producto(s) más.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <button
                type="button"
                disabled={bulkSaving || bulkPreview.length === 0}
                onClick={() => void applyBulkPrices()}
                className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
              >
                {bulkSaving ? 'Actualizando precios...' : `Aplicar nuevos precios (${bulkPreview.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Catálogo Digital Público */}
      {showCatalogModal && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !catalogSaving && setShowCatalogModal(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Globe className="w-5 h-5 text-indigo-600" /> Catálogo digital con pedidos online
              </h2>
              <button
                onClick={() => !catalogSaving && setShowCatalogModal(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Comparte este enlace por WhatsApp o redes sociales. Tus clientes podrán ver fotos y precios sin iniciar sesión, armar su pedido y enviarlo directo a tu bandeja de <strong>Cotizaciones</strong>.
            </p>

            {catalogLoading ? (
              <p className="text-sm text-slate-400 py-8 text-center">Cargando enlace de tu catálogo...</p>
            ) : (
              <div className="space-y-4">
                {catalogUrl ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5">
                    <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Enlace público de {catalogCompanyName}
                    </label>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={catalogUrl}
                        onFocus={e => e.currentTarget.select()}
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs text-slate-700"
                      />
                      <button
                        type="button"
                        onClick={() => void copyCatalogUrl()}
                        className="inline-flex items-center gap-1.5 bg-slate-800 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-700 shrink-0 whitespace-nowrap"
                      >
                        {catalogCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {catalogCopied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(
                          `Hola, mira nuestro catálogo actualizado de *${catalogCompanyName}* y haz tu pedido en línea aquí:\n${catalogUrl}`
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-emerald-700 whitespace-nowrap"
                      >
                        <MessageCircle className="w-3.5 h-3.5" /> Compartir por WhatsApp
                      </a>

                      {onPreviewCatalog && catalogCompanyId && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowCatalogModal(false)
                            onPreviewCatalog(catalogCompanyId)
                          }}
                          className="inline-flex items-center gap-1.5 bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-xs font-medium hover:bg-slate-100 whitespace-nowrap"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Vista previa del catálogo
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Ejecuta en Supabase el script SQL <strong>20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql</strong> para generar el enlace único de tu empresa.
                  </div>
                )}

                {!readOnly && (
                  <div className="border-t border-slate-100 pt-4 space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Opciones de visibilidad
                    </h3>

                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
                      <span>Permitir ver el catálogo y recibir pedidos online</span>
                      <input
                        type="checkbox"
                        checked={catalogEnabled}
                        onChange={e => setCatalogEnabled(e.target.checked)}
                        className="accent-slate-800 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
                      <span>Mostrar precios por mayor automáticos por volumen</span>
                      <input
                        type="checkbox"
                        checked={catalogShowWholesale}
                        onChange={e => setCatalogShowWholesale(e.target.checked)}
                        className="accent-slate-800 w-4 h-4"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700 cursor-pointer">
                      <span>Mostrar cantidad disponible en inventario</span>
                      <input
                        type="checkbox"
                        checked={catalogShowStock}
                        onChange={e => setCatalogShowStock(e.target.checked)}
                        className="accent-slate-800 w-4 h-4"
                      />
                    </label>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Mensaje de bienvenida (opcional)
                      </label>
                      <input
                        value={catalogWelcome}
                        onChange={e => setCatalogWelcome(e.target.value)}
                        maxLength={200}
                        placeholder="Ej: Pedidos al detal y mayor · Entregas el mismo día"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
                      />
                    </div>

                    {catalogFeedback && (
                      <div className="text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
                        {catalogFeedback}
                      </div>
                    )}

                    <button
                      type="button"
                      disabled={catalogSaving}
                      onClick={() => void saveCatalogSettings()}
                      className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
                    >
                      {catalogSaving ? 'Guardando...' : 'Guardar configuración del catálogo'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal Importación masiva CSV */}
      {showImport && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !importing && setShowImport(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-slate-800">Importar o actualizar desde Excel (CSV)</h2>
              <button
                onClick={() => !importing && setShowImport(false)}
                className="p-1 rounded hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Si el código <strong>SKU</strong> ya existe en tu catálogo, se actualizarán sus precios, costo y mínimo (sin borrar su stock actual). Si el SKU es nuevo, se creará el producto con su stock inicial.
            </p>

            <div className="space-y-3">
              <button
                type="button"
                onClick={downloadTemplate}
                className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg"
              >
                <FileSpreadsheet className="w-4 h-4" /> Descargar plantilla de ejemplo (.csv)
              </button>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Selecciona tu archivo CSV guardado desde Excel
                </label>
                <input
                  type="file"
                  accept=".csv,.txt"
                  disabled={importing}
                  onChange={onFileSelect}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-800 file:text-white hover:file:bg-slate-700"
                />
              </div>

              {importError && (
                <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {importError}
                </div>
              )}

              {importRows.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-slate-800">
                    Vista previa: {importRows.length} fila(s) válidas ({newCount} nuevos · {updateCount} por actualizar)
                  </p>
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 text-xs">
                    {importRows.slice(0, 25).map((r, idx) => (
                      <div key={idx} className="py-1.5 flex items-center justify-between gap-2">
                        <span className="text-slate-700 truncate">
                          <strong>{r.sku}</strong> · {r.name}
                        </span>
                        <span className="text-slate-500 shrink-0 tabular-nums">
                          {money(r.price)} · {r.existingId ? 'Actualizar' : `Nuevo (${r.initialStock})`}
                        </span>
                      </div>
                    ))}
                    {importRows.length > 25 && (
                      <p className="pt-2 text-[11px] text-slate-400">
                        …y {importRows.length - 25} producto(s) más.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <button
                type="button"
                disabled={importing || importRows.length === 0}
                onClick={() => void runImport()}
                className="w-full bg-slate-800 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-40"
              >
                {importing ? 'Procesando productos...' : `Aplicar importación (${importRows.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {scanning && <BarcodeScanner onDetect={onScanSku} onClose={() => setScanning(false)} />}

      {/* Modal Ajustar stock */}
      {adjusting && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setAdjusting(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-bold text-slate-800">Ajustar stock</h2>
              <button onClick={() => setAdjusting(null)} className="p-1 rounded hover:bg-slate-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500 mb-4 tabular-nums">
              {adjusting.name} · stock actual: {adjusting.stock}
            </p>

            {adjError && (
              <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                {adjError}
              </div>
            )}

            <form onSubmit={handleAdjust} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Stock real (conteo físico)
                </label>
                <input
                  required
                  type="number"
                  step="any"
                  min="0"
                  value={newStock}
                  onChange={e => setNewStock(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm tabular-nums"
                />
              </div>

              <input
                required
                value={adjReason}
                onChange={e => setAdjReason(e.target.value)}
                placeholder="Motivo (ej: conteo, merma, daño)"
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm"
              />

              <div className="flex justify-between text-sm pt-2 border-t border-slate-100 tabular-nums">
                <span className="text-slate-500">Diferencia</span>
                <span className={`font-bold ${diff > 0 ? 'text-emerald-600' : diff < 0 ? 'text-red-600' : 'text-slate-500'}`}>
                  {diff > 0 ? '+' : ''}{diff}
                </span>
              </div>

              <button
                type="submit"
                disabled={saving || diff === 0}
                className="w-full bg-slate-800 text-white py-2 rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Registrar ajuste'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal Confirmar eliminación */}
      {confirmDelete && !readOnly && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !deleting && setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-bold text-slate-800">¿Eliminar producto?</h2>
            <p className="text-xs text-slate-600">
              Se eliminará <strong>{confirmDelete.name}</strong> ({confirmDelete.sku}) del catálogo si no tiene historial de ventas ni movimientos en Kardex.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void executeDelete()}
                className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
      <ProductPhotoLightbox
        product={
          previewProduct
            ? {
                id: previewProduct.id,
                name: previewProduct.name,
                sku: previewProduct.sku,
                categoryName: previewProduct.category_id
                  ? catMap.get(previewProduct.category_id) || 'Catálogo'
                  : 'Sin categoría',
                description: previewProduct.description,
                unit: previewProduct.unit,
                priceLabel: money(previewProduct.price),
                wholesaleLabel: previewProduct.price_wholesale
                  ? `Mayorista: ${money(previewProduct.price_wholesale)}${
                      previewProduct.wholesale_min_qty
                        ? ` (desde ${previewProduct.wholesale_min_qty} ${previewProduct.unit})`
                        : ''
                    }`
                  : null,
                stockLabel: `Stock actual: ${previewProduct.stock} ${previewProduct.unit}`,
                outOfStock: Number(previewProduct.stock) <= 0,
                image_url: previewProduct.image_url,
              }
            : null
        }
        onClose={() => setPreviewProduct(null)}
        canEditPhoto={!readOnly}
        companyId={user?.company_id}
        onPhotoUpdated={
          previewProduct && !readOnly
            ? nextUrl => quickUpdateProductPhoto(previewProduct, nextUrl)
            : undefined
        }
      />
      <CatalogBrandModal
        open={brandModalOpen}
        onClose={() => setBrandModalOpen(false)}
      />
      <SqlActivationModal
        open={sqlModalOpen}
        onClose={() => setSqlModalOpen(false)}
        initialBundle="images"
      />
    </div>
  )
}
