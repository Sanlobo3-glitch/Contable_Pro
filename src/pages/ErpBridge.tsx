import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  ArrowLeftRight,
  BookOpen,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Globe,
  Key,
  Loader2,
  Cloud,
  Package,
  Play,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth, canViewAccounting, isCompanyManager, isReadOnly } from '../lib/auth'
import { useCurrency, fmtNum } from '../lib/currency'
import { downloadCsv } from '../lib/csv'
import {
  buildAccountingVouchersFromOperations,
  exportAccountingVouchersForErp,
  exportProductsForErp,
  exportThirdPartiesForErp,
  inferPucTypeAndNature,
  parseErpProductsCsv,
  parseErpPucAccountsCsv,
  parseErpThirdPartiesCsv,
  parseErpVouchersCsv,
  getStoredErpApiConfig,
  saveStoredErpApiConfig,
  testErpApiConnection,
  executeErpBidirectionalSync,
  type ErpAccountLite,
  type ErpJournalLineFlat,
  type ExternalErpSystem,
  type ParsedErpProduct,
  type ParsedErpPucAccount,
  type ParsedErpThirdParty,
  type ParsedErpVoucherGroup,
  type ErpApiCredentialConfig,
  type ErpAuthMethod,
  type ErpSyncDirection,
  type ErpSyncLogEntry,
  type ErpSyncExecutionResult,
} from '../lib/erpBridge'
import type {
  CompanyConfig,
  Customer,
  ErpSyncEntityPreferences,
  Expense,
  Product,
  Purchase,
  Sale,
  Supplier,
} from '../types'

type BridgeDirection = 'api_sync' | 'export' | 'import'
type ImportKind = 'terceros' | 'productos' | 'puc' | 'comprobantes'

const todayIso = () => new Date().toLocaleDateString('sv-SE')
const monthStartIso = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toLocaleDateString('sv-SE')
}

export default function ErpBridge({
  onNavigate,
}: {
  onNavigate?: (page: string) => void
}) {
  const { user } = useAuth()
  const { currency } = useCurrency()
  const readOnly = isReadOnly(user)
  const allowed = canViewAccounting(user?.role) || isCompanyManager(user?.role)

  const [direction, setDirection] = useState<BridgeDirection>('api_sync')
  const [targetErp, setTargetErp] = useState<ExternalErpSystem>('siigo')
  const [chunkSiigoFiles, setChunkSiigoFiles] = useState(true)
  const [dateFrom, setDateFrom] = useState(monthStartIso())
  const [dateTo, setDateTo] = useState(todayIso())
  const [showPucConfig, setShowPucConfig] = useState(false)

  // Configuración de Credenciales API & Sincronización en Vivo
  const [apiConfig, setApiConfig] = useState<ErpApiCredentialConfig>(() =>
    getStoredErpApiConfig(user?.company_id || 'default', 'siigo')
  )
  const [showSecrets, setShowSecrets] = useState(false)
  const [testingConn, setTestingConn] = useState(false)
  const [connFeedback, setConnFeedback] = useState<{
    ok: boolean
    message: string
    details?: Record<string, unknown>
  } | null>(null)
  const [dryRun, setDryRun] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState(0)
  const [syncStage, setSyncStage] = useState('')
  const [syncLogs, setSyncLogs] = useState<ErpSyncLogEntry[]>([])
  const [syncResult, setSyncResult] = useState<ErpSyncExecutionResult | null>(null)

  // Mapeo PUC estándar colombiano editable
  const [pucMap, setPucMap] = useState({
    cash: '110505',
    bank: '111005',
    receivable: '130505',
    inventory: '143501',
    payable: '220505',
    taxPayable: '240801',
    salesIncome: '413501',
    expenseDefault: '519595',
    costOfSales: '613501',
  })

  // Datos vivos de Contable Pro / InventarioPro
  const [loading, setLoading] = useState(true)
  const [companyCfg, setCompanyCfg] = useState<CompanyConfig | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [accounts, setAccounts] = useState<ErpAccountLite[]>([])
  const [journalLines, setJournalLines] = useState<ErpJournalLineFlat[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])

  // Estado de Importación desde Siigo / Loggro
  const [importKind, setImportKind] = useState<ImportKind>('terceros')
  const [importFilename, setImportFilename] = useState('')
  const [parsedThirds, setParsedThirds] = useState<ParsedErpThirdParty[]>([])
  const [parsedProducts, setParsedProducts] = useState<ParsedErpProduct[]>([])
  const [parsedPuc, setParsedPuc] = useState<ParsedErpPucAccount[]>([])
  const [parsedVouchers, setParsedVouchers] = useState<ParsedErpVoucherGroup[]>([])
  const [syncImportedStock, setSyncImportedStock] = useState(true)
  const [autoCreateMissingPuc, setAutoCreateMissingPuc] = useState(true)
  const [migrating, setMigrating] = useState(false)
  const [progressText, setProgressText] = useState('')
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadWorkspaceData = useCallback(async () => {
    setLoading(true)
    const fromTs = `${dateFrom}T00:00:00`
    const toTs = `${dateTo}T23:59:59`

    const [cfgRes, custRes, supRes, prodRes, accRes, entRes, salRes, purRes, expRes] =
      await Promise.all([
        supabase.from('company_config').select('*').limit(1).maybeSingle(),
        supabase.from('customers').select('*').order('name'),
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('products').select('*').order('name'),
        supabase.from('acc_accounts').select('id, code, name, type, nature, is_postable, active').order('code'),
        supabase
          .from('acc_entries')
          .select('id, number, entry_date, description, status, source_type, acc_lines(debit, credit, memo, acc_accounts(code, name))')
          .eq('status', 'contabilizado')
          .gte('entry_date', dateFrom)
          .lte('entry_date', dateTo)
          .order('entry_date', { ascending: true }),
        supabase
          .from('sales')
          .select('*')
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('created_at', { ascending: true }),
        supabase
          .from('purchases')
          .select('*')
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('created_at', { ascending: true }),
        supabase
          .from('expenses')
          .select('*')
          .gte('expense_date', dateFrom)
          .lte('expense_date', dateTo)
          .order('expense_date', { ascending: true }),
      ])

    if (cfgRes.data) setCompanyCfg(cfgRes.data as CompanyConfig)
    setCustomers((custRes.data || []) as Customer[])
    setSuppliers((supRes.data || []) as Supplier[])
    setProducts((prodRes.data || []) as Product[])
    setAccounts((accRes.data || []) as ErpAccountLite[])
    setSales((salRes.data || []) as Sale[])
    setPurchases((purRes.data || []) as Purchase[])
    setExpenses((expRes.data || []) as Expense[])

    const flatLines: ErpJournalLineFlat[] = []
    const companyNit = (cfgRes.data as CompanyConfig | null)?.rif || '222222222222'
    const companyName =
      (cfgRes.data as CompanyConfig | null)?.name || user?.company_name || 'Contable Pro'

    for (const rawEntry of (entRes.data || []) as Array<Record<string, unknown>>) {
      const entryNum = String(rawEntry.number || '')
      const entryDate = String(rawEntry.entry_date || '')
      const sourceType = String(rawEntry.source_type || 'manual')
      const entryDesc = String(rawEntry.description || '')
      const rawLines = Array.isArray(rawEntry.acc_lines) ? rawEntry.acc_lines : []

      for (const rl of rawLines as Array<Record<string, unknown>>) {
        const accObj = rl.acc_accounts as { code?: string; name?: string } | null
        flatLines.push({
          entryNumber: entryNum,
          entryDate,
          sourceType,
          accountCode: accObj?.code || pucMap.salesIncome,
          accountName: accObj?.name || 'Cuenta contable',
          thirdPartyDoc: companyNit,
          thirdPartyName: companyName,
          description: String(rl.memo || entryDesc || `Movimiento ${entryNum}`),
          debit: Number(rl.debit) || 0,
          credit: Number(rl.credit) || 0,
        })
      }
    }

    setJournalLines(flatLines)
    setLoading(false)
  }, [dateFrom, dateTo, pucMap.salesIncome, user?.company_name])

  useEffect(() => {
    if (allowed) {
      void loadWorkspaceData()
    }
  }, [allowed, loadWorkspaceData])

  const effectiveVoucherLines = useMemo(
    () =>
      buildAccountingVouchersFromOperations({
        journalLines,
        sales,
        purchases,
        expenses,
        companyNit: companyCfg?.rif || '222222222222',
        pucMap: {
          cash: pucMap.cash,
          bank: pucMap.bank,
          receivable: pucMap.receivable,
          inventory: pucMap.inventory,
          payable: pucMap.payable,
          taxPayable: pucMap.taxPayable,
          salesIncome: pucMap.salesIncome,
          expenseDefault: pucMap.expenseDefault,
        },
      }),
    [journalLines, sales, purchases, expenses, companyCfg?.rif, pucMap]
  )

  const voucherTotals = useMemo(() => {
    const debit = effectiveVoucherLines.reduce((acc, l) => acc + (Number(l.debit) || 0), 0)
    const credit = effectiveVoucherLines.reduce((acc, l) => acc + (Number(l.credit) || 0), 0)
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      usingSynthesized: journalLines.length === 0 && effectiveVoucherLines.length > 0,
    }
  }, [effectiveVoucherLines, journalLines.length])

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500">
        No tienes permisos para acceder al puente contable Siigo / Loggro.
      </p>
    )
  }

  // Sincronizar configuración API según ERP seleccionado
  useEffect(() => {
    const cid = companyCfg?.rif || user?.company_id || 'default'
    const stored = getStoredErpApiConfig(cid, targetErp)
    setApiConfig(stored)
    setConnFeedback(null)
  }, [targetErp, companyCfg?.rif, user?.company_id])

  const handleSaveCredentials = useCallback(() => {
    const cid = companyCfg?.rif || user?.company_id || 'default'
    saveStoredErpApiConfig(cid, apiConfig)
    setFeedback({
      ok: true,
      text: `Configuración y credenciales de ${
        apiConfig.system === 'siigo' ? 'SIIGO Nube' : 'Loggro Pymes'
      } guardadas correctamente.`,
    })
  }, [companyCfg?.rif, user?.company_id, apiConfig])

  const handleTestConnection = useCallback(async () => {
    setTestingConn(true)
    setConnFeedback(null)
    try {
      const res = await testErpApiConnection(apiConfig)
      setConnFeedback(res)
      if (res.ok) {
        const cid = companyCfg?.rif || user?.company_id || 'default'
        saveStoredErpApiConfig(cid, apiConfig)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error inesperado de comunicación'
      setConnFeedback({
        ok: false,
        message: `Fallo al verificar credenciales con la API: ${msg}`,
      })
    } finally {
      setTestingConn(false)
    }
  }, [apiConfig, companyCfg?.rif, user?.company_id])

  const handleStartBidirectionalSync = useCallback(async () => {
    if (readOnly) {
      setFeedback({
        ok: false,
        text: 'Tu usuario está configurado en modo de solo lectura.',
      })
      return
    }
    setSyncing(true)
    setSyncProgress(5)
    setSyncStage('Iniciando handshake y validación con API ERP...')
    setSyncLogs([])
    setSyncResult(null)
    setFeedback(null)

    try {
      const res = await executeErpBidirectionalSync({
        cfg: apiConfig,
        customers,
        suppliers,
        products,
        sales,
        companyNit: companyCfg?.rif || '222222222222',
        dryRun,
        onProgress: (stage, pct) => {
          setSyncStage(stage)
          setSyncProgress(pct)
        },
      })

      setSyncResult(res)
      setSyncLogs(res.logs)

      const updatedCfg: ErpApiCredentialConfig = {
        ...apiConfig,
        lastSyncAt: new Date().toISOString(),
        lastSyncStatus: res.ok ? 'ok' : 'warning',
        lastSyncSummary: res.summary,
      }
      setApiConfig(updatedCfg)
      const cid = companyCfg?.rif || user?.company_id || 'default'
      saveStoredErpApiConfig(cid, updatedCfg)

      setFeedback({
        ok: res.ok,
        text: res.summary,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error durante el intercambio de datos'
      setFeedback({
        ok: false,
        text: `Error de sincronización con ${
          apiConfig.system === 'siigo' ? 'SIIGO' : 'Loggro'
        }: ${msg}`,
      })
    } finally {
      setSyncing(false)
    }
  }, [
    readOnly,
    apiConfig,
    customers,
    suppliers,
    products,
    sales,
    companyCfg?.rif,
    dryRun,
    user?.company_id,
  ])

  function resetImportPreview() {
    setImportFilename('')
    setParsedThirds([])
    setParsedProducts([])
    setParsedPuc([])
    setParsedVouchers([])
  }

  function handleSelectImportKind(k: ImportKind) {
    setImportKind(k)
    resetImportPreview()
    setFeedback(null)
  }

  function handleExportThirdParties() {
    if (customers.length + suppliers.length === 0) {
      setFeedback({
        ok: false,
        text: 'Aún no hay clientes ni proveedores registrados para exportar.',
      })
      return
    }
    const res = exportThirdPartiesForErp({
      target: targetErp,
      customers,
      suppliers,
      chunkForSiigo: targetErp === 'siigo' && chunkSiigoFiles,
      dateStamp: todayIso(),
    })
    setFeedback({
      ok: true,
      text: `Se exportaron ${res.rowsExported} terceros en formato oficial ${
        targetErp === 'siigo' ? 'Siigo Nube (con DV DIAN)' : 'Loggro Pymes'
      } (${res.filesGenerated} archivo${res.filesGenerated > 1 ? 's' : ''}).`,
    })
  }

  function handleExportProducts() {
    if (products.length === 0) {
      setFeedback({
        ok: false,
        text: 'Aún no hay productos en el catálogo para exportar.',
      })
      return
    }
    const res = exportProductsForErp({
      target: targetErp,
      products,
      pucInventoryCode: pucMap.inventory,
      pucIncomeCode: pucMap.salesIncome,
      pucCostCode: pucMap.costOfSales,
      taxRate: Number(companyCfg?.tax_rate ?? 19),
      chunkForSiigo: targetErp === 'siigo' && chunkSiigoFiles,
      dateStamp: todayIso(),
    })
    setFeedback({
      ok: true,
      text: `Se exportaron ${res.rowsExported} productos/ítems para ${
        targetErp === 'siigo' ? 'Siigo Nube' : 'Loggro Pymes'
      } (${res.filesGenerated} archivo${res.filesGenerated > 1 ? 's' : ''}).`,
    })
  }

  function handleExportVouchers() {
    if (effectiveVoucherLines.length === 0) {
      setFeedback({
        ok: false,
        text: 'No se encontraron asientos ni operaciones en el rango de fechas seleccionado.',
      })
      return
    }
    const res = exportAccountingVouchersForErp({
      target: targetErp,
      lines: effectiveVoucherLines,
      chunkForSiigo: targetErp === 'siigo' && chunkSiigoFiles,
      dateStamp: `${dateFrom}_a_${dateTo}`,
    })
    setFeedback({
      ok: true,
      text: `Interfaz contable generada: ${res.rowsExported} líneas de partida doble para ${
        targetErp === 'siigo' ? 'Siigo Nube' : 'Loggro Pymes'
      } (${res.filesGenerated} archivo${res.filesGenerated > 1 ? 's' : ''}).`,
    })
  }

  function handleDownloadSampleTemplate() {
    if (importKind === 'terceros') {
      downloadCsv(
        'plantilla_migracion_terceros_siigo_loggro.csv',
        [
          'Tipo de tercero',
          'Tipo de persona',
          'Tipo de identificación',
          'Número de identificación',
          'Dígito de verificación',
          'Razón social',
          'Nombres',
          'Apellidos',
          'Dirección',
          'Teléfono',
          'Correo electrónico',
        ],
        [
          [
            'Cliente',
            'Empresa',
            '31',
            '900456789',
            '4',
            'Comercializadora Andina SAS',
            '',
            '',
            'Calle 80 # 15-20 Bogotá',
            '3105551234',
            'facturacion@andina.co',
          ],
          [
            'Proveedor',
            'Persona',
            '13',
            '79888777',
            '',
            '',
            'Carlos',
            'Ramírez Gómez',
            'Carrera 12 # 9-40',
            '3154449988',
            'carlos.proveedor@correo.com',
          ],
        ]
      )
      return
    }

    if (importKind === 'productos') {
      downloadCsv(
        'plantilla_migracion_productos_siigo_loggro.csv',
        [
          'Código del producto',
          'Nombre del producto / Servicio',
          'Unidad de medida',
          'Precio de venta 1',
          'Precio mayorista 2',
          'Costo unitario',
          'Stock actual',
          'Stock mínimo',
        ],
        [
          ['SKU-101', 'Camisa Oxford Industrial', 'unidad', 55000, 48000, 32000, 40, 8],
          ['SKU-102', 'Jean Dotación Clásico', 'unidad', 68000, 60000, 41000, 25, 5],
        ]
      )
      return
    }

    if (importKind === 'puc') {
      downloadCsv(
        'plantilla_migracion_puc_siigo_loggro.csv',
        ['Código cuenta contable', 'Nombre cuenta', 'Auxiliar'],
        [
          ['110505', 'Caja general', 'Si'],
          ['111005', 'Bancos moneda nacional', 'Si'],
          ['130505', 'Clientes nacionales', 'Si'],
          ['143501', 'Mercancías no fabricadas por la empresa', 'Si'],
          ['220505', 'Proveedores nacionales', 'Si'],
          ['413501', 'Comercio al por mayor y al por menor', 'Si'],
        ]
      )
      return
    }

    downloadCsv(
      'plantilla_migracion_comprobantes_siigo_loggro.csv',
      [
        'Consecutivo comprobante',
        'Fecha de elaboración',
        'Código cuenta contable',
        'Nombre cuenta',
        'Identificación tercero',
        'Nombre tercero',
        'Descripción movimiento',
        'Valor Débito',
        'Valor Crédito',
      ],
      [
        [
          'SI-001',
          todayIso(),
          '111005',
          'Bancos moneda nacional',
          '900456789',
          'Saldos iniciales Siigo',
          'Traslado saldo inicial bancos',
          2500000,
          0,
        ],
        [
          'SI-001',
          todayIso(),
          '311505',
          'Aportes sociales',
          '900456789',
          'Saldos iniciales Siigo',
          'Contrapartida patrimonio inicial',
          0,
          2500000,
        ],
      ]
    )
  }

  async function handleFileSelected(file: File) {
    setFeedback(null)
    resetImportPreview()
    setImportFilename(file.name)

    try {
      const text = await file.text()
      if (importKind === 'terceros') {
        const list = parseErpThirdPartiesCsv(text)
        if (list.length === 0) {
          setFeedback({
            ok: false,
            text: 'No se reconocieron terceros válidos. Verifica que el archivo esté guardado como CSV UTF-8 o delimitado por punto y coma (;).',
          })
          return
        }
        setParsedThirds(list)
        return
      }

      if (importKind === 'productos') {
        const list = parseErpProductsCsv(text)
        if (list.length === 0) {
          setFeedback({
            ok: false,
            text: 'No se reconocieron productos/ítems en el archivo seleccionado.',
          })
          return
        }
        setParsedProducts(list)
        return
      }

      if (importKind === 'puc') {
        const list = parseErpPucAccountsCsv(text)
        if (list.length === 0) {
          setFeedback({
            ok: false,
            text: 'No se reconocieron cuentas PUC en el archivo seleccionado.',
          })
          return
        }
        setParsedPuc(list)
        return
      }

      const list = parseErpVouchersCsv(text)
      if (list.length === 0) {
        setFeedback({
          ok: false,
          text: 'No se detectaron líneas contables con código de cuenta y valores débito/crédito.',
        })
        return
      }
      setParsedVouchers(list)
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'No se pudo leer el archivo CSV.',
      })
    }
  }

  async function executeMigrationToContablePro() {
    if (readOnly || migrating) return
    setMigrating(true)
    setFeedback(null)

    try {
      if (importKind === 'terceros' && parsedThirds.length > 0) {
        let custCreated = 0
        let custUpdated = 0
        let supCreated = 0
        let supUpdated = 0

        const custByDoc = new Map<string, Customer>()
        const custByName = new Map<string, Customer>()
        for (const c of customers) {
          if (c.document) custByDoc.set(c.document.replace(/[^\dA-Za-z]/g, '').toLowerCase(), c)
          custByName.set(c.name.trim().toLowerCase(), c)
        }

        const supByDoc = new Map<string, Supplier>()
        const supByName = new Map<string, Supplier>()
        for (const s of suppliers) {
          if (s.document) supByDoc.set(s.document.replace(/[^\dA-Za-z]/g, '').toLowerCase(), s)
          supByName.set(s.name.trim().toLowerCase(), s)
        }

        for (let i = 0; i < parsedThirds.length; i++) {
          const t = parsedThirds[i]
          setProgressText(`Migrando tercero ${i + 1} de ${parsedThirds.length}...`)
          const docKey = t.document.replace(/[^\dA-Za-z]/g, '').toLowerCase()
          const nameKey = t.name.trim().toLowerCase()

          if (t.role === 'cliente' || t.role === 'ambos') {
            const existing = (docKey && custByDoc.get(docKey)) || custByName.get(nameKey)
            const payload = {
              name: t.name,
              document: t.document || null,
              email: t.email || null,
              phone: t.phone || null,
              address: t.address || null,
            }
            if (existing) {
              const { error } = await supabase
                .from('customers')
                .update(payload)
                .eq('id', existing.id)
              if (!error) custUpdated += 1
            } else {
              const { error } = await supabase
                .from('customers')
                .insert({ ...payload, price_type: 'detal' })
              if (!error) custCreated += 1
            }
          }

          if (t.role === 'proveedor' || t.role === 'ambos') {
            const existing = (docKey && supByDoc.get(docKey)) || supByName.get(nameKey)
            const payload = {
              name: t.name,
              document: t.document || null,
              email: t.email || null,
              phone: t.phone || null,
              address: t.address || null,
            }
            if (existing) {
              const { error } = await supabase
                .from('suppliers')
                .update(payload)
                .eq('id', existing.id)
              if (!error) supUpdated += 1
            } else {
              const { error } = await supabase.from('suppliers').insert(payload)
              if (!error) supCreated += 1
            }
          }
        }

        await loadWorkspaceData()
        resetImportPreview()
        setFeedback({
          ok: true,
          text: `Migración de terceros completada: ${custCreated} clientes nuevos (${custUpdated} actualizados) y ${supCreated} proveedores nuevos (${supUpdated} actualizados).`,
        })
        return
      }

      if (importKind === 'productos' && parsedProducts.length > 0) {
        let created = 0
        let updated = 0
        const prodBySku = new Map<string, Product>()
        const prodByName = new Map<string, Product>()
        for (const p of products) {
          if (p.sku) prodBySku.set(p.sku.trim().toLowerCase(), p)
          prodByName.set(p.name.trim().toLowerCase(), p)
        }

        for (let i = 0; i < parsedProducts.length; i++) {
          const item = parsedProducts[i]
          setProgressText(`Migrando ítem ${i + 1} de ${parsedProducts.length}...`)
          const existing =
            (item.sku && prodBySku.get(item.sku.trim().toLowerCase())) ||
            prodByName.get(item.name.trim().toLowerCase())

          const basePayload = {
            name: item.name,
            sku: item.sku || null,
            price: item.price,
            price_wholesale: item.priceWholesale,
            cost: item.cost,
            min_stock: item.minStock,
            unit: item.unit || 'unidad',
          }

          if (existing) {
            const { error } = await supabase
              .from('products')
              .update(basePayload)
              .eq('id', existing.id)
            if (!error) {
              updated += 1
              if (syncImportedStock && item.stock >= 0 && Number(existing.stock) !== item.stock) {
                await supabase.rpc('ajustar_stock', {
                  p_product_id: existing.id,
                  p_new_stock: item.stock,
                  p_reason: 'Sincronización desde Siigo / Loggro',
                })
              }
            }
          } else {
            const { data, error } = await supabase
              .from('products')
              .insert({ ...basePayload, stock: 0 })
              .select('id')
              .single()

            if (!error && data?.id) {
              created += 1
              if (item.stock > 0) {
                await supabase.rpc('ajustar_stock', {
                  p_product_id: data.id,
                  p_new_stock: item.stock,
                  p_reason: 'Saldo inicial migrado de Siigo / Loggro',
                })
              }
            }
          }
        }

        await loadWorkspaceData()
        resetImportPreview()
        setFeedback({
          ok: true,
          text: `Catálogo migrado con éxito: ${created} productos creados y ${updated} actualizados en Contable Pro.`,
        })
        return
      }

      if (importKind === 'puc' && parsedPuc.length > 0) {
        const sorted = [...parsedPuc].sort((a, b) => a.code.length - b.code.length)
        const existingByCode = new Map(accounts.map(a => [a.code.replace(/\./g, ''), a]))
        let savedCount = 0

        for (let i = 0; i < sorted.length; i++) {
          const item = sorted[i]
          setProgressText(`Importando cuenta PUC ${item.code} (${i + 1}/${sorted.length})...`)
          const cleanCode = item.code.replace(/\./g, '')
          const existing = existingByCode.get(cleanCode) || accounts.find(a => a.code === item.code)

          const { error } = await supabase.rpc('acc_upsert_account', {
            p_id: existing?.id || null,
            p_code: item.code,
            p_name: item.name,
            p_description: 'Migrada desde Siigo / Loggro',
            p_type: item.type,
            p_nature: item.nature,
            p_parent: null,
            p_postable: item.postable,
            p_active: true,
          })
          if (!error) savedCount += 1
        }

        await loadWorkspaceData()
        resetImportPreview()
        setFeedback({
          ok: true,
          text: `Plan Único de Cuentas sincronizado: ${savedCount} cuentas creadas o actualizadas en Contable Pro.`,
        })
        return
      }

      if (importKind === 'comprobantes' && parsedVouchers.length > 0) {
        const balancedGroups = parsedVouchers.filter(v => v.balanced)
        if (balancedGroups.length === 0) {
          setFeedback({
            ok: false,
            text: 'Ningún comprobante del archivo cumple partida doble exacta (Débitos = Créditos). Revisa el archivo antes de importar.',
          })
          return
        }

        // Asegurar cuentas PUC en memoria o crearlas si está habilitado
        let workingAccounts = [...accounts]
        const findAccount = (rawCode: string) => {
          const clean = rawCode.replace(/\./g, '')
          return workingAccounts.find(
            a => a.code === rawCode || a.code.replace(/\./g, '') === clean
          )
        }

        if (autoCreateMissingPuc) {
          const missingMap = new Map<string, string>()
          for (const g of balancedGroups) {
            for (const l of g.lines) {
              if (!findAccount(l.accountCode)) {
                missingMap.set(l.accountCode, l.accountName || `Auxiliar ${l.accountCode}`)
              }
            }
          }

          if (missingMap.size > 0) {
            setProgressText(`Creando ${missingMap.size} cuentas auxiliares PUC faltantes...`)
            for (const [code, name] of missingMap.entries()) {
              const inf = inferPucTypeAndNature(code)
              await supabase.rpc('acc_upsert_account', {
                p_id: null,
                p_code: code,
                p_name: name,
                p_description: 'Creada automáticamente al migrar comprobantes Siigo/Loggro',
                p_type: inf.type,
                p_nature: inf.nature,
                p_parent: null,
                p_postable: true,
                p_active: true,
              })
            }
            const refreshed = await supabase
              .from('acc_accounts')
              .select('id, code, name, type, nature, is_postable, active')
            workingAccounts = (refreshed.data || []) as ErpAccountLite[]
          }
        }

        let posted = 0
        let skipped = 0

        for (let i = 0; i < balancedGroups.length; i++) {
          const g = balancedGroups[i]
          setProgressText(
            `Contabilizando comprobante ${g.voucherKey} (${i + 1}/${balancedGroups.length})...`
          )
          const rpcLines = g.lines
            .map(l => {
              const acc = findAccount(l.accountCode)
              if (!acc) return null
              return {
                account_id: acc.id,
                debit: l.debit,
                credit: l.credit,
                memo: l.memo,
              }
            })
            .filter((x): x is NonNullable<typeof x> => Boolean(x))

          if (rpcLines.length !== g.lines.length) {
            skipped += 1
            continue
          }

          const { error } = await supabase.rpc('acc_create_entry', {
            p_date: g.date,
            p_description: g.description,
            p_lines: rpcLines,
            p_post: true,
          })

          if (!error) posted += 1
          else skipped += 1
        }

        await loadWorkspaceData()
        resetImportPreview()
        setFeedback({
          ok: posted > 0,
          text:
            posted > 0
              ? `Se contabilizaron ${posted} comprobantes en el Libro Diario de Contable Pro${
                  skipped > 0 ? ` (${skipped} omitidos por cuentas no imputables o período cerrado)` : ''
                }.`
              : 'No se pudieron contabilizar los comprobantes. Verifica que las cuentas sean auxiliares imputables y que el período no esté cerrado.',
        })
      }
    } finally {
      setMigrating(false)
      setProgressText('')
    }
  }

  const readyImportCount =
    importKind === 'terceros'
      ? parsedThirds.length
      : importKind === 'productos'
        ? parsedProducts.length
        : importKind === 'puc'
          ? parsedPuc.length
          : parsedVouchers.filter(v => v.balanced).length

  return (
    <div className="space-y-5 max-w-6xl">
      {/* Encabezado */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 mb-1">
            <ArrowLeftRight className="w-3.5 h-3.5" />
            Interoperabilidad Contable Colombia · PUC y Partida Doble
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Puente Bidireccional SIIGO ↔ Contable Pro ↔ LOGGRO
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Transfiere copias completas de terceros, inventario, cuentas PUC y comprobantes contables en ambos sentidos mediante plantillas planas oficiales compatibles con Excel.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadWorkspaceData()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Actualizar saldos
          </button>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('accounting')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Ir a Libros Contables
            </button>
          )}
        </div>
      </div>

      {/* KPIs del repositorio actual en Contable Pro */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Terceros activos</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {customers.length + suppliers.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {customers.length} clientes · {suppliers.length} proveedores
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Ítems de inventario</span>
            <Package className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {products.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Con precios, costos y stock actual
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Plan de Cuentas (PUC)</span>
            <BookOpen className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {accounts.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {accounts.filter(a => a.is_postable).length} auxiliares imputables
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Líneas contables ({currency})</span>
            <FileSpreadsheet className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-xl font-bold text-slate-900 tabular-nums mt-1">
            {effectiveVoucherLines.length}
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
            {voucherTotals.usingSynthesized
              ? 'Sintetizadas desde operaciones'
              : 'Tomadas del Libro Diario'}
          </p>
        </div>
      </div>

      {/* Selector de dirección de transferencia */}
      <div className="flex flex-col sm:flex-row gap-1.5 p-1.5 bg-white rounded-xl border border-slate-200 shadow-xs">
        <button
          type="button"
          onClick={() => {
            setDirection('api_sync')
            setFeedback(null)
          }}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            direction === 'api_sync'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>1. Sincronización API en Vivo (SIIGO & Loggro)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setDirection('export')
            setFeedback(null)
          }}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            direction === 'export'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Download className="w-4 h-4 text-sky-400 shrink-0" />
          <span>2. Exportar Archivos CSV (Contable Pro → ERP)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setDirection('import')
            setFeedback(null)
          }}
          className={`flex-1 py-2.5 px-4 rounded-lg text-xs sm:text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
            direction === 'import'
              ? 'bg-slate-900 text-white shadow-xs'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Upload className="w-4 h-4 text-amber-400 shrink-0" />
          <span>3. Migrar Archivos CSV (ERP → Contable Pro)</span>
        </button>
      </div>

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 flex items-center justify-between gap-3 text-xs ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded hover:bg-black/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* =====================================================================
          PESTAÑA 1: SINCRONIZACIÓN API EN VIVO (SIIGO NUBE & LOGGRO PYMES)
      ====================================================================== */}
      {direction === 'api_sync' && (
        <div className="space-y-5">
          {/* Selector de ERP y Entorno */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Puente Integrador API REST
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  Conexión Directa en la Nube con ERP Externo
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sincroniza clientes con NIT y DV DIAN, catálogo con inventario multibodega y facturación en tiempo real.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setTargetErp('siigo')
                      setApiConfig(prev => ({ ...prev, system: 'siigo' }))
                    }}
                    className={`px-3 py-1.5 rounded-md font-bold transition-colors ${
                      targetErp === 'siigo'
                        ? 'bg-white text-emerald-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    SIIGO Nube
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTargetErp('loggro')
                      setApiConfig(prev => ({ ...prev, system: 'loggro' }))
                    }}
                    className={`px-3 py-1.5 rounded-md font-bold transition-colors ${
                      targetErp === 'loggro'
                        ? 'bg-white text-indigo-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Loggro Pymes
                  </button>
                </div>

                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setApiConfig(prev => ({ ...prev, environment: 'production' }))
                    }
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                      apiConfig.environment === 'production'
                        ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Producción
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setApiConfig(prev => ({ ...prev, environment: 'sandbox' }))
                    }
                    className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                      apiConfig.environment === 'sandbox'
                        ? 'bg-amber-600 text-white shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sandbox / Pruebas
                  </button>
                </div>
              </div>
            </div>

            {/* Info bar del endpoint y estado */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <div className="flex items-center gap-2">
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                <span className="font-mono text-[11px] text-slate-600">
                  {apiConfig.environment === 'production'
                    ? targetErp === 'siigo'
                      ? 'https://api.siigo.com/v1'
                      : 'https://api.loggro.com/api/v1'
                    : targetErp === 'siigo'
                      ? 'https://sandbox-api.siigo.com/v1'
                      : 'https://sandbox.loggro.com/api/v1'}
                </span>
              </div>
              {apiConfig.lastSyncAt && (
                <div className="flex items-center gap-1.5 text-slate-600">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Última sinc: {new Date(apiConfig.lastSyncAt).toLocaleString('es-CO')}</span>
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      apiConfig.lastSyncStatus === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Grid de 2 Columnas: Credenciales vs Selección de Entidades */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Columna 1: Credenciales API */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">
                        Credenciales de Autenticación
                      </h4>
                      <p className="text-[11px] text-slate-500">
                        {targetErp === 'siigo'
                          ? 'Generadas en SIIGO Nube → Configuración → Más configuraciones → API'
                          : 'Generadas en Loggro → Configuración de Integraciones API'}
                      </p>
                    </div>
                  </div>

                  {/* Toggle Método */}
                  <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setApiConfig(prev => ({ ...prev, authMethod: 'api_key' }))}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        apiConfig.authMethod === 'api_key'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      API Key
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiConfig(prev => ({ ...prev, authMethod: 'oauth2' }))}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                        apiConfig.authMethod === 'oauth2'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      OAuth 2.0
                    </button>
                  </div>
                </div>

                {/* Formulario SIIGO */}
                {targetErp === 'siigo' && (
                  <div className="space-y-3">
                    {apiConfig.authMethod === 'api_key' ? (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Usuario / Correo registrado en SIIGO API
                          </label>
                          <input
                            type="email"
                            value={apiConfig.siigoUsername}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, siigoUsername: e.target.value }))
                            }
                            placeholder="admin@tuempresa.com"
                            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>

                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-slate-700">
                              Access Key (Clave de Acceso API)
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowSecrets(!showSecrets)}
                              className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                            >
                              {showSecrets ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                              {showSecrets ? 'Ocultar' : 'Mostrar'}
                            </button>
                          </div>
                          <input
                            type={showSecrets ? 'text' : 'password'}
                            value={apiConfig.siigoAccessKey}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, siigoAccessKey: e.target.value }))
                            }
                            placeholder="eyJhbGciOi..."
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Partner-Id (Header de Integrador)
                          </label>
                          <input
                            type="text"
                            value={apiConfig.siigoPartnerId}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, siigoPartnerId: e.target.value }))
                            }
                            placeholder="ContablePro-Bridge (Opcional)"
                            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Client ID (OAuth 2.0)
                          </label>
                          <input
                            type="text"
                            value={apiConfig.siigoClientId}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, siigoClientId: e.target.value }))
                            }
                            placeholder="siigo-client-id-..."
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-slate-700">
                              Client Secret (OAuth 2.0)
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowSecrets(!showSecrets)}
                              className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                            >
                              {showSecrets ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                              {showSecrets ? 'Ocultar' : 'Mostrar'}
                            </button>
                          </div>
                          <input
                            type={showSecrets ? 'text' : 'password'}
                            value={apiConfig.siigoClientSecret}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, siigoClientSecret: e.target.value }))
                            }
                            placeholder="secret_..."
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Formulario Loggro */}
                {targetErp === 'loggro' && (
                  <div className="space-y-3">
                    {apiConfig.authMethod === 'api_key' ? (
                      <>
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-semibold text-slate-700">
                              API Token / Secret Key de Loggro
                            </label>
                            <button
                              type="button"
                              onClick={() => setShowSecrets(!showSecrets)}
                              className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                            >
                              {showSecrets ? (
                                <EyeOff className="w-3 h-3" />
                              ) : (
                                <Eye className="w-3 h-3" />
                              )}
                              {showSecrets ? 'Ocultar' : 'Mostrar'}
                            </button>
                          </div>
                          <input
                            type={showSecrets ? 'text' : 'password'}
                            value={apiConfig.loggroApiKey}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, loggroApiKey: e.target.value }))
                            }
                            placeholder="Token generado en Loggro API"
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            ID de Organización / Empresa Loggro
                          </label>
                          <input
                            type="text"
                            value={apiConfig.loggroCompanyId}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, loggroCompanyId: e.target.value }))
                            }
                            placeholder="Ej: 900123456 o UUID de compañía"
                            className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Client ID (OAuth 2.0 Loggro)
                          </label>
                          <input
                            type="text"
                            value={apiConfig.loggroClientId}
                            onChange={e =>
                              setApiConfig(prev => ({ ...prev, loggroClientId: e.target.value }))
                            }
                            placeholder="loggro-oauth-client-id"
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Client Secret (OAuth 2.0 Loggro)
                          </label>
                          <input
                            type={showSecrets ? 'text' : 'password'}
                            value={apiConfig.loggroClientSecret}
                            onChange={e =>
                              setApiConfig(prev => ({
                                ...prev,
                                loggroClientSecret: e.target.value,
                              }))
                            }
                            placeholder="loggro-client-secret"
                            className="w-full text-xs font-mono px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Resultado de prueba de conexión */}
                {connFeedback && (
                  <div
                    className={`rounded-lg p-3 text-xs border ${
                      connFeedback.ok
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-red-900'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {connFeedback.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className="font-semibold">{connFeedback.message}</p>
                        {connFeedback.details && (
                          <div className="mt-1 text-[11px] space-y-0.5 text-slate-600 font-mono">
                            {Boolean(connFeedback.details.endpoint) && (
                              <p>URL: {String(connFeedback.details.endpoint)}</p>
                            )}
                            {Boolean(connFeedback.details.latency) && (
                              <p>Latencia: {String(connFeedback.details.latency)}</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Botonera de Credenciales */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConn}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 border border-slate-300 disabled:opacity-50"
                >
                  {testingConn ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  )}
                  {testingConn ? 'Verificando con API...' : 'Probar Conexión en Vivo'}
                </button>

                <button
                  type="button"
                  onClick={handleSaveCredentials}
                  className="px-4 py-2 bg-slate-900 hover:bg-black text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  Guardar
                </button>
              </div>
            </div>

            {/* Columna 2: Selección de Entidades y Sentido de Flujo */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                    <Database className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      Entidades y Reglas de Sincronización
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Selecciona las entidades que se transferirán y el sentido del flujo
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3.5">
                {/* Entidad 1: Clientes y Terceros */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    apiConfig.entities.customers.enabled
                      ? 'border-emerald-200 bg-emerald-50/20'
                      : 'border-slate-200 bg-slate-50/50 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="chk-sync-cust"
                        checked={apiConfig.entities.customers.enabled}
                        onChange={e =>
                          setApiConfig(prev => ({
                            ...prev,
                            entities: {
                              ...prev.entities,
                              customers: {
                                ...prev.entities.customers,
                                enabled: e.target.checked,
                              },
                            },
                          }))
                        }
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <label htmlFor="chk-sync-cust" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-emerald-600" />
                        Clientes y Terceros
                        <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-mono">
                          {customers.length} clientes
                        </span>
                      </label>
                    </div>

                    <select
                      value={apiConfig.entities.customers.direction}
                      disabled={!apiConfig.entities.customers.enabled}
                      onChange={e =>
                        setApiConfig(prev => ({
                          ...prev,
                          entities: {
                            ...prev.entities,
                            customers: {
                              ...prev.entities.customers,
                              direction: e.target.value as ErpSyncDirection,
                            },
                          },
                        }))
                      }
                      className="text-[11px] font-semibold bg-white border border-slate-300 rounded-md px-2 py-1 text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 disabled:bg-slate-100"
                    >
                      <option value="bidirectional">Bidireccional (⇄)</option>
                      <option value="push_to_erp">Inventario Pro → ERP (→)</option>
                      <option value="pull_from_erp">ERP → Inventario Pro (←)</option>
                    </select>
                  </div>

                  {apiConfig.entities.customers.enabled && (
                    <div className="mt-2.5 pt-2 border-t border-emerald-100/60 flex items-center justify-between text-[11px] text-slate-600">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={apiConfig.entities.customers.includeSuppliers}
                          onChange={e =>
                            setApiConfig(prev => ({
                              ...prev,
                              entities: {
                                ...prev.entities,
                                customers: {
                                  ...prev.entities.customers,
                                  includeSuppliers: e.target.checked,
                                },
                              },
                            }))
                          }
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>Incluir proveedores ({suppliers.length}) en la sincronización</span>
                      </label>
                      <span className="text-emerald-700 font-medium">Cálculo DV DIAN activo</span>
                    </div>
                  )}
                </div>

                {/* Entidad 2: Inventario y Catálogo de Productos */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    apiConfig.entities.products.enabled
                      ? 'border-indigo-200 bg-indigo-50/20'
                      : 'border-slate-200 bg-slate-50/50 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="chk-sync-prod"
                        checked={apiConfig.entities.products.enabled}
                        onChange={e =>
                          setApiConfig(prev => ({
                            ...prev,
                            entities: {
                              ...prev.entities,
                              products: {
                                ...prev.entities.products,
                                enabled: e.target.checked,
                              },
                            },
                          }))
                        }
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <label htmlFor="chk-sync-prod" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                        <Package className="w-3.5 h-3.5 text-indigo-600" />
                        Catálogo de Productos & Precios
                        <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-mono">
                          {products.length} ítems
                        </span>
                      </label>
                    </div>

                    <select
                      value={apiConfig.entities.products.direction}
                      disabled={!apiConfig.entities.products.enabled}
                      onChange={e =>
                        setApiConfig(prev => ({
                          ...prev,
                          entities: {
                            ...prev.entities,
                            products: {
                              ...prev.entities.products,
                              direction: e.target.value as ErpSyncDirection,
                            },
                          },
                        }))
                      }
                      className="text-[11px] font-semibold bg-white border border-slate-300 rounded-md px-2 py-1 text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
                    >
                      <option value="bidirectional">Bidireccional (⇄)</option>
                      <option value="push_to_erp">Inventario Pro → ERP (→)</option>
                      <option value="pull_from_erp">ERP → Inventario Pro (←)</option>
                    </select>
                  </div>

                  {apiConfig.entities.products.enabled && (
                    <div className="mt-2.5 pt-2 border-t border-indigo-100/60 flex items-center justify-between text-[11px] text-slate-600">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={apiConfig.entities.products.syncStock}
                          onChange={e =>
                            setApiConfig(prev => ({
                              ...prev,
                              entities: {
                                ...prev.entities,
                                products: {
                                  ...prev.entities.products,
                                  syncStock: e.target.checked,
                                },
                              },
                            }))
                          }
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>Sincronizar existencias físicas y stock multibodega</span>
                      </label>
                      <span className="text-indigo-700 font-medium">SKU, IVA y costos</span>
                    </div>
                  )}
                </div>

                {/* Entidad 3: Facturas de Venta */}
                <div
                  className={`p-3.5 rounded-xl border transition-all ${
                    apiConfig.entities.invoices.enabled
                      ? 'border-sky-200 bg-sky-50/20'
                      : 'border-slate-200 bg-slate-50/50 opacity-70'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="chk-sync-inv"
                        checked={apiConfig.entities.invoices.enabled}
                        onChange={e =>
                          setApiConfig(prev => ({
                            ...prev,
                            entities: {
                              ...prev.entities,
                              invoices: {
                                ...prev.entities.invoices,
                                enabled: e.target.checked,
                              },
                            },
                          }))
                        }
                        className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      <label htmlFor="chk-sync-inv" className="text-xs font-bold text-slate-900 cursor-pointer flex items-center gap-1.5">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-sky-600" />
                        Facturas de Venta & Comprobantes
                        <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-mono">
                          {sales.length} comprobantes
                        </span>
                      </label>
                    </div>

                    <select
                      value={apiConfig.entities.invoices.direction}
                      disabled={!apiConfig.entities.invoices.enabled}
                      onChange={e =>
                        setApiConfig(prev => ({
                          ...prev,
                          entities: {
                            ...prev.entities,
                            invoices: {
                              ...prev.entities.invoices,
                              direction: e.target.value as ErpSyncDirection,
                            },
                          },
                        }))
                      }
                      className="text-[11px] font-semibold bg-white border border-slate-300 rounded-md px-2 py-1 text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-sky-500 disabled:bg-slate-100"
                    >
                      <option value="push_to_erp">Inventario Pro → ERP (→)</option>
                      <option value="bidirectional">Bidireccional (⇄)</option>
                      <option value="pull_from_erp">ERP → Inventario Pro (←)</option>
                    </select>
                  </div>

                  {apiConfig.entities.invoices.enabled && (
                    <div className="mt-2.5 pt-2 border-t border-sky-100/60 grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5 font-medium">
                          Desde fecha
                        </label>
                        <input
                          type="date"
                          value={apiConfig.entities.invoices.dateFrom}
                          onChange={e =>
                            setApiConfig(prev => ({
                              ...prev,
                              entities: {
                                ...prev.entities,
                                invoices: {
                                  ...prev.entities.invoices,
                                  dateFrom: e.target.value,
                                },
                              },
                            }))
                          }
                          className="w-full text-xs px-2 py-1 border border-slate-200 rounded-md bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5 font-medium">
                          Hasta fecha
                        </label>
                        <input
                          type="date"
                          value={apiConfig.entities.invoices.dateTo}
                          onChange={e =>
                            setApiConfig(prev => ({
                              ...prev,
                              entities: {
                                ...prev.entities,
                                invoices: {
                                  ...prev.entities.invoices,
                                  dateTo: e.target.value,
                                },
                              },
                            }))
                          }
                          className="w-full text-xs px-2 py-1 border border-slate-200 rounded-md bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Centro de Ejecución en Vivo & Log Forense */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <RefreshCw className={`w-4 h-4 text-emerald-600 ${syncing ? 'animate-spin' : ''}`} />
                  Centro de Ejecución de Sincronización
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Ejecuta el protocolo bidireccional respetando las entidades seleccionadas y las cuentas contables DIAN.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer bg-slate-50 px-3 py-2 rounded-lg border border-slate-200">
                  <input
                    type="checkbox"
                    checked={dryRun}
                    onChange={e => setDryRun(e.target.checked)}
                    className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                  <span className="font-semibold text-slate-700">Modo Simulación (Dry-Run)</span>
                </label>

                <button
                  type="button"
                  onClick={handleStartBidirectionalSync}
                  disabled={syncing}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-2 shadow-xs disabled:opacity-50"
                >
                  {syncing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{syncStage || 'Procesando sincronización...'}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current" />
                      <span>Iniciar Sincronización Bidireccional</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Barra de progreso interactiva */}
            {(syncing || syncProgress > 0) && (
              <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{syncStage}</span>
                  <span className="font-mono font-bold text-slate-900">{syncProgress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-600 h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${syncProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Resumen de Métricas */}
            {syncResult && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                  <p className="text-[11px] text-emerald-800 font-medium">Clientes Procesados</p>
                  <p className="text-xl font-bold text-emerald-950 tabular-nums">
                    {syncResult.customersProcessed}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100">
                  <p className="text-[11px] text-indigo-800 font-medium">Catálogo & Precios</p>
                  <p className="text-xl font-bold text-indigo-950 tabular-nums">
                    {syncResult.productsProcessed}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-sky-50 border border-sky-100">
                  <p className="text-[11px] text-sky-800 font-medium">Facturas / Asientos</p>
                  <p className="text-xl font-bold text-sky-950 tabular-nums">
                    {syncResult.invoicesProcessed}
                  </p>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <p className="text-[11px] text-slate-700 font-medium">Alertas / Errores</p>
                  <p className="text-xl font-bold text-slate-900 tabular-nums">
                    {syncResult.errorsCount}
                  </p>
                </div>
              </div>
            )}

            {/* Tabla de Log Forense en Vivo */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-bold text-slate-900">
                  Registro Forense de Eventos de Sincronización ({syncLogs.length})
                </span>
                {syncLogs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSyncLogs([])}
                    className="text-[11px] text-slate-400 hover:text-slate-700"
                  >
                    Limpiar log
                  </button>
                )}
              </div>

              {syncLogs.length === 0 ? (
                <div className="text-center py-8 border border-dashed border-slate-200 rounded-xl text-xs text-slate-400">
                  No hay eventos recientes en esta sesión. Pulsa &quot;Iniciar Sincronización Bidireccional&quot; o &quot;Probar Conexión en Vivo&quot; para registrar operaciones.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 text-slate-600 text-[11px] font-semibold border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Hora</th>
                        <th className="px-3 py-2">Entidad</th>
                        <th className="px-3 py-2">Acción / Sentido</th>
                        <th className="px-3 py-2">Estado</th>
                        <th className="px-3 py-2 text-right">Registros</th>
                        <th className="px-3 py-2">Detalles Técnicos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans">
                      {syncLogs.map(log => (
                        <tr key={log.id} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                            {log.timestamp}
                          </td>
                          <td className="px-3 py-2 font-bold text-slate-800">
                            {log.entity}
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            {log.action}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {log.status === 'ok' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                                <CheckCircle2 className="w-3 h-3" /> Exitoso
                              </span>
                            ) : log.status === 'warn' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" /> Aviso
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">
                                <AlertCircle className="w-3 h-3" /> Error
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-bold tabular-nums text-slate-900">
                            {log.recordsCount}
                          </td>
                          <td className="px-3 py-2 text-slate-600 max-w-xs truncate" title={log.details}>
                            {log.details}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PESTAÑA 2: EXPORTAR DESDE CONTABLE PRO HACIA SIIGO O LOGGRO
      ====================================================================== */}
      {direction === 'export' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-end">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Sistema contable de destino
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetErp('siigo')}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-bold text-left transition-colors ${
                      targetErp === 'siigo'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block">SIIGO Nube / Pyme</span>
                    <span
                      className={`text-[10px] font-normal ${
                        targetErp === 'siigo' ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      DV DIAN + bloques 500 filas
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetErp('loggro')}
                    className={`px-3 py-2.5 rounded-lg border text-xs font-bold text-left transition-colors ${
                      targetErp === 'loggro'
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span className="block">LOGGRO Pymes</span>
                    <span
                      className={`text-[10px] font-normal ${
                        targetErp === 'loggro' ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      Persona N/J + Encabezado
                    </span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Desde fecha
                  </label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Hasta fecha
                  </label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2">
                {targetErp === 'siigo' && (
                  <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={chunkSiigoFiles}
                      onChange={e => setChunkSiigoFiles(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Dividir cada 500 filas (límite Siigo)
                  </label>
                )}

                <button
                  type="button"
                  onClick={() => setShowPucConfig(v => !v)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                  Cuentas PUC puente
                </button>
              </div>
            </div>

            {showPucConfig && (
              <div className="pt-3 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { key: 'cash', label: 'Caja general' },
                  { key: 'bank', label: 'Bancos nacionales' },
                  { key: 'receivable', label: 'Clientes (CxC)' },
                  { key: 'inventory', label: 'Inventario mercancías' },
                  { key: 'payable', label: 'Proveedores (CxP)' },
                  { key: 'salesIncome', label: 'Ingresos por ventas' },
                  { key: 'costOfSales', label: 'Costo de ventas' },
                  { key: 'expenseDefault', label: 'Gastos operativos' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      {f.label}
                    </label>
                    <input
                      value={pucMap[f.key as keyof typeof pucMap]}
                      onChange={e =>
                        setPucMap(prev => ({ ...prev, [f.key]: e.target.value.trim() }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-mono"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3 Tarjetas de Descarga Oficial */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
                  <Users className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  1. Directorio de Terceros
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {targetErp === 'siigo'
                    ? 'Incluye Clientes y Proveedores con separación automática de NIT, cálculo del Dígito de Verificación DIAN (Módulo 11) y códigos fiscales 13 / 31.'
                    : 'Genera la plantilla de Contactos de Loggro Pymes distinguiendo Persona Natural (N) y Jurídica (J), NIT sin dígito concatenado y relación comercial.'}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Listos: <strong>{customers.length + suppliers.length}</strong> registros
                </p>
                <button
                  type="button"
                  onClick={handleExportThirdParties}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar Terceros ({targetErp === 'siigo' ? 'Siigo' : 'Loggro'})
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center">
                  <Package className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  2. Catálogo de Productos e Ítems
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {targetErp === 'siigo'
                    ? 'Exporta códigos SKU, precios detal y mayorista, costo unitario, stock actual, unidad DIAN (94) y cuentas PUC de inventario, ingreso y costo.'
                    : 'Genera el maestro de Ítems Inventariables para Loggro Pymes con precios, costo unitario, existencias disponibles y parametrización contable.'}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-[11px] text-slate-500 tabular-nums">
                  Listos: <strong>{products.length}</strong> ítems activos
                </p>
                <button
                  type="button"
                  onClick={handleExportProducts}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar Productos ({targetErp === 'siigo' ? 'Siigo' : 'Loggro'})
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
                  <Building2 className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-900">
                  3. Comprobantes Contables (PUC)
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {targetErp === 'siigo'
                    ? 'Genera el comprobante tipo CC de partida doble sin puntos en el código PUC, listo para subir en Siigo Nube → Contabilidad → Importación.'
                    : 'Genera el archivo unificado con Código Encabezado, fecha, tercero y sumas iguales Débito/Crédito para Loggro Pymes.'}
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex justify-between text-[11px] text-slate-600 tabular-nums">
                  <span>Débitos: {fmtNum(voucherTotals.debit, 0, 2)}</span>
                  <span>Créditos: {fmtNum(voucherTotals.credit, 0, 2)}</span>
                </div>
                <button
                  type="button"
                  onClick={handleExportVouchers}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar Comprobantes ({effectiveVoucherLines.length} líneas)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          PESTAÑA 3: MIGRAR ARCHIVOS CSV DESDE SIIGO O LOGGRO HACIA CONTABLE PRO
      ====================================================================== */}
      {direction === 'import' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              ¿Qué información exportada de Siigo o Loggro deseas traer a Contable Pro?
            </label>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {(
                [
                  {
                    id: 'terceros',
                    title: 'Terceros',
                    sub: 'Clientes y Proveedores',
                  },
                  {
                    id: 'productos',
                    title: 'Productos / Ítems',
                    sub: 'Precios, costos y stock',
                  },
                  {
                    id: 'puc',
                    title: 'Plan de Cuentas',
                    sub: 'Catálogo PUC',
                  },
                  {
                    id: 'comprobantes',
                    title: 'Comprobantes',
                    sub: 'Asientos y saldos iniciales',
                  },
                ] as const
              ).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleSelectImportKind(opt.id)}
                  className={`p-3 rounded-xl border text-left transition-colors ${
                    importKind === opt.id
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-slate-50/70 hover:bg-slate-100 text-slate-800'
                  }`}
                >
                  <p className="text-xs font-bold">{opt.title}</p>
                  <p
                    className={`text-[11px] mt-0.5 ${
                      importKind === opt.id ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {opt.sub}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs sm:text-sm font-bold text-slate-900">
                Sube el reporte exportado desde Siigo o Loggro en formato CSV (.csv)
              </p>
              <p className="text-xs text-slate-500">
                Si tienes el archivo en Excel (.xlsx), ábrelo y elige «Guardar como → CSV UTF-8 (delimitado por comas o punto y coma)». El lector reconoce automáticamente los encabezados de Siigo y de Loggro.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadSampleTemplate}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700"
              >
                <Download className="w-3.5 h-3.5" />
                Plantilla guía CSV
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void handleFileSelected(f)
                }}
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold"
              >
                <Upload className="w-3.5 h-3.5" />
                Seleccionar archivo CSV
              </button>
            </div>
          </div>

          {/* Opciones adicionales según tipo */}
          {importKind === 'productos' && parsedProducts.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={syncImportedStock}
                onChange={e => setSyncImportedStock(e.target.checked)}
                className="rounded border-slate-300"
              />
              Ajustar también el stock físico de productos ya existentes según la columna de existencias del archivo
            </label>
          )}

          {importKind === 'comprobantes' && parsedVouchers.length > 0 && (
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={autoCreateMissingPuc}
                onChange={e => setAutoCreateMissingPuc(e.target.checked)}
                className="rounded border-slate-300"
              />
              Crear automáticamente en Contable Pro las cuentas auxiliares PUC que vengan en el comprobante y aún no existan
            </label>
          )}

          {/* Vista previa antes de migrar */}
          {(parsedThirds.length > 0 ||
            parsedProducts.length > 0 ||
            parsedPuc.length > 0 ||
            parsedVouchers.length > 0) && (
            <div className="space-y-3 pt-2 border-t border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-700">
                  Archivo analizado: <strong>{importFilename}</strong> ·{' '}
                  <strong className="text-emerald-700">{readyImportCount}</strong> registros listos
                  para migrar a Contable Pro
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={migrating}
                    onClick={resetImportPreview}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Limpiar
                  </button>

                  <button
                    type="button"
                    disabled={readOnly || migrating || readyImportCount === 0}
                    onClick={() => void executeMigrationToContablePro()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {migrating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {progressText || 'Ejecutando migración...'}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Confirmar migración a Contable Pro ({readyImportCount})
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Tabla previsualización Terceros */}
              {importKind === 'terceros' && parsedThirds.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Relación</th>
                        <th className="text-left px-3 py-2">Persona</th>
                        <th className="text-left px-3 py-2">Identificación</th>
                        <th className="text-left px-3 py-2">Nombre / Razón Social</th>
                        <th className="text-left px-3 py-2">Teléfono</th>
                        <th className="text-left px-3 py-2">Correo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedThirds.slice(0, 30).map((t, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-medium capitalize">{t.role}</td>
                          <td className="px-3 py-2">{t.personType === 'J' ? 'Jurídica' : 'Natural'}</td>
                          <td className="px-3 py-2 font-mono">{t.document || '—'}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{t.name}</td>
                          <td className="px-3 py-2">{t.phone || '—'}</td>
                          <td className="px-3 py-2">{t.email || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tabla previsualización Productos */}
              {importKind === 'productos' && parsedProducts.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">SKU / Código</th>
                        <th className="text-left px-3 py-2">Nombre del ítem</th>
                        <th className="text-right px-3 py-2">Precio Venta</th>
                        <th className="text-right px-3 py-2">Costo</th>
                        <th className="text-right px-3 py-2">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedProducts.slice(0, 30).map((p, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-mono">{p.sku}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{p.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.price, 0, 2)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNum(p.cost, 0, 2)}</td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">{p.stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tabla previsualización PUC */}
              {importKind === 'puc' && parsedPuc.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Código PUC</th>
                        <th className="text-left px-3 py-2">Nombre de la cuenta</th>
                        <th className="text-left px-3 py-2">Clase</th>
                        <th className="text-left px-3 py-2">Naturaleza</th>
                        <th className="text-left px-3 py-2">Imputable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedPuc.slice(0, 30).map((a, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-mono font-semibold">{a.code}</td>
                          <td className="px-3 py-2 text-slate-900">{a.name}</td>
                          <td className="px-3 py-2 capitalize">{a.type}</td>
                          <td className="px-3 py-2 capitalize">{a.nature}</td>
                          <td className="px-3 py-2">{a.postable ? 'Auxiliar (Sí)' : 'Grupo (No)'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tabla previsualización Comprobantes */}
              {importKind === 'comprobantes' && parsedVouchers.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-72">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-slate-600 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Comprobante</th>
                        <th className="text-left px-3 py-2">Fecha</th>
                        <th className="text-right px-3 py-2">Líneas</th>
                        <th className="text-right px-3 py-2">Total Débito</th>
                        <th className="text-right px-3 py-2">Total Crédito</th>
                        <th className="text-left px-3 py-2">Partida Doble</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parsedVouchers.slice(0, 30).map((v, i) => (
                        <tr key={i}>
                          <td className="px-3 py-2 font-mono font-bold text-slate-900">
                            {v.voucherKey}
                          </td>
                          <td className="px-3 py-2">{v.date}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{v.lines.length}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtNum(v.totalDebit, 0, 2)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtNum(v.totalCredit, 0, 2)}
                          </td>
                          <td className="px-3 py-2">
                            {v.balanced ? (
                              <span className="text-emerald-700 font-semibold">Cuadrado</span>
                            ) : (
                              <span className="text-red-600 font-semibold">Descuadrado</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
