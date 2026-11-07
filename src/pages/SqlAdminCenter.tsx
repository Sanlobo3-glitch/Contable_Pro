import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileCode2,
  History,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import {
  supabase,
  hasRealSupabaseConfig,
  getConfiguredSupabaseHost,
  getSupabaseSqlEditorUrl,
} from '../lib/supabase'
import { useAuth, MASTER_DEV_EMAIL } from '../lib/auth'
import { fmtDateTime } from '../lib/currency'
import { copyToClipboard } from '../lib/copilotShare'
import { SQL_SCRIPT_BUNDLES, type SqlScriptBundle } from '../lib/sqlScripts'

interface SchemaItemStatus {
  name: string
  label: string
  installed: boolean
}

interface MigrationLogRow {
  id: string
  script_id: string
  script_title: string
  executed_email: string
  status: string
  summary: string | null
  statements_length: number
  executed_at: string
}

const PROBE_TABLES: { name: string; label: string }[] = [
  { name: 'profiles', label: 'Perfiles y roles de usuario' },
  { name: 'member_profiles', label: 'Expedientes de personal y nómina' },
  { name: 'branches', label: 'Sucursales y centros de costo' },
  { name: 'warehouses', label: 'Bodegas multibodega' },
  { name: 'purchase_orders', label: 'Órdenes de compra y recepción' },
  { name: 'financial_budgets', label: 'Presupuesto maestro financiero' },
  { name: 'product_images', label: 'Imágenes reales POS y catálogo PDF' },
  { name: 'catalog_orders', label: 'Pedidos web de catálogo y captures de pago' },
  { name: 'support_tickets', label: 'Soporte técnico y sesiones autorizadas' },
  { name: 'cpa_working_papers', label: 'Papeles de trabajo y firma CPC' },
  { name: 'acc_accounts', label: 'Plan de cuentas contables' },
  { name: 'acc_entries', label: 'Libro diario y comprobantes' },
  { name: 'blind_inventory_sessions', label: 'Auditorías de toma física ciega' },
  { name: 'layaway_contracts', label: 'Contratos de Plan Separe y apartados' },
  { name: 'product_exchanges', label: 'Cambios mano a mano y garantías' },
  { name: 'bank_reconciliations', label: 'Actas de conciliación bancaria' },
  { name: 'sql_migration_log', label: 'Bitácora y motor SQL en 1 clic' },
]

export default function SqlAdminCenter() {
  const { user, isDemo, isMasterAccount } = useAuth()
  const role = user?.role
  const isSuperAdmin =
    (role === 'admin' || (role as string) === 'super_admin' || isMasterAccount) &&
    !['contador', 'gerente', 'vendedor'].includes(role || '')
  const allowed = isSuperAdmin

  if (!isSuperAdmin) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center max-w-xl mx-auto my-12 shadow-sm">
        <ShieldCheck className="w-12 h-12 text-red-600 mx-auto mb-4" />
        <h2 className="text-lg font-bold text-red-950">Acceso Restringido: Administrador Central Requerido</h2>
        <p className="text-sm text-red-700 mt-2">
          El Centro de Scripts SQL y Supabase es exclusivo del Administrador Central ('super_admin').
          Los roles de Contador, Gerente y Vendedor tienen prohibido el acceso o ejecución de este panel por políticas estrictas de seguridad.
        </p>
      </div>
    )
  }

  const realConfigured = hasRealSupabaseConfig()
  const supabaseHost = getConfiguredSupabaseHost()
  const sqlEditorUrl = getSupabaseSqlEditorUrl()
  const connectedToReal = realConfigured && !isDemo

  const [tab, setTab] = useState<'library' | 'custom' | 'schema'>('library')
  const [selectedId, setSelectedId] = useState<SqlScriptBundle['id']>('consolidated')
  const [search, setSearch] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Estado de diagnóstico de esquema y bitácora
  const [diagLoading, setDiagLoading] = useState(true)
  const [pgVersion, setPgVersion] = useState<string | null>(null)
  const [engineReady, setEngineReady] = useState(false)
  const [serverApiReady, setServerApiReady] = useState(false)
  const [tableStatuses, setTableStatuses] = useState<SchemaItemStatus[]>([])
  const [rpcStatuses, setRpcStatuses] = useState<SchemaItemStatus[]>([])
  const [logs, setLogs] = useState<MigrationLogRow[]>([])

  // Ejecución y mensajes
  const [executing, setExecuting] = useState(false)
  const [bootstrapGuideVisible, setBootstrapGuideVisible] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  // Editor personalizado
  const [customTitle, setCustomTitle] = useState('Migración personalizada InventarioPro')
  const [customFilename, setCustomFilename] = useState('custom_migracion_inventariopro.sql')
  const [customSql, setCustomSql] = useState(
    '-- Escribe o pega aquí cualquier sentencia SQL idempotente para tu proyecto Supabase\n-- Exclusivo para ejecución administrativa de sanlobo3@hotmail.com\n\nSELECT now() AS verificado_en;\n'
  )

  const checkDiagnostics = useCallback(async () => {
    if (!allowed) return
    setDiagLoading(true)

    try {
      // 1. Consultar pasarela de Management API en el servidor con verificación en vivo (?verify=1)
      let managementDiagUsed = false
      try {
        const apiCheck = await fetch('/api/admin-sql?verify=1', { method: 'GET' })
        if (apiCheck.ok) {
          const json = (await apiCheck.json()) as {
            serverSqlConfigured?: boolean
            managementApiLive?: boolean
            diagnostics?: {
              pg_version?: string
              tables?: SchemaItemStatus[]
              rpcs?: SchemaItemStatus[]
            } | null
          }
          const isLive = Boolean(json?.serverSqlConfigured && json?.managementApiLive)
          setServerApiReady(isLive)

          if (isLive && json.diagnostics) {
            const tbls = Array.isArray(json.diagnostics.tables) ? json.diagnostics.tables : []
            const rpcs = Array.isArray(json.diagnostics.rpcs) ? json.diagnostics.rpcs : []
            setPgVersion(json.diagnostics.pg_version || null)
            setTableStatuses(tbls)
            setRpcStatuses(rpcs)
            setEngineReady(
              rpcs.some(r => r.name === 'admin_ejecutar_migracion_sql' && r.installed)
            )
            managementDiagUsed = true
          }
        }
      } catch {
        setServerApiReady(false)
      }

      // 2. Si no hubo lectura directa por Management API, intentar RPC admin_diagnostico_esquema (migración 000017)
      if (!managementDiagUsed) {
        const { data: diagData, error: diagErr } = await supabase.rpc('admin_diagnostico_esquema')

        if (!diagErr && diagData && typeof diagData === 'object') {
          const parsed = diagData as {
            pg_version?: string
            tables?: SchemaItemStatus[]
            rpcs?: SchemaItemStatus[]
          }
          const tbls = Array.isArray(parsed.tables) ? parsed.tables : []
          const rpcs = Array.isArray(parsed.rpcs) ? parsed.rpcs : []
          setPgVersion(parsed.pg_version || null)
          setTableStatuses(tbls)
          setRpcStatuses(rpcs)
          const hasEngine = rpcs.some(
            r => r.name === 'admin_ejecutar_migracion_sql' && r.installed
          )
          setEngineReady(hasEngine)
        } else {
          // Fallback antes de instalar 000017: sondeo directo ligero tabla por tabla vía PostgREST
          setPgVersion(null)
          setEngineReady(false)
          setRpcStatuses([])

          const results = await Promise.all(
            PROBE_TABLES.map(async t => {
              const { error } = await supabase
                .from(t.name)
                .select('*', { count: 'exact', head: true })
                .limit(1)
              const missing =
                error &&
                /relation|does not exist|schema cache|PGRST205|42P01/i.test(error.message || '')
              return {
                name: t.name,
                label: t.label,
                installed: !missing,
              }
            })
          )
          setTableStatuses(results)
        }
      }

      // 3. Cargar bitácora de migraciones si ya existe la tabla
      const { data: logRows, error: logErr } = await supabase
        .from('sql_migration_log')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(40)

      if (!logErr && Array.isArray(logRows)) {
        setLogs(logRows as MigrationLogRow[])
      } else {
        setLogs([])
      }
    } finally {
      setDiagLoading(false)
    }
  }, [allowed])

  useEffect(() => {
    void checkDiagnostics()
  }, [checkDiagnostics])

  const filteredBundles = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return SQL_SCRIPT_BUNDLES
    return SQL_SCRIPT_BUNDLES.filter(
      b =>
        b.title.toLowerCase().includes(q) ||
        b.filename.toLowerCase().includes(q) ||
        b.summary.toLowerCase().includes(q) ||
        b.sql.toLowerCase().includes(q)
    )
  }, [search])

  const activeBundle = useMemo(
    () => SQL_SCRIPT_BUNDLES.find(b => b.id === selectedId) || SQL_SCRIPT_BUNDLES[0],
    [selectedId]
  )

  const installedCount = useMemo(
    () => tableStatuses.filter(t => t.installed).length,
    [tableStatuses]
  )

  const pendingTables = useMemo(
    () => tableStatuses.filter(t => !t.installed),
    [tableStatuses]
  )

  if (!allowed) {
    return (
      <p className="text-sm text-slate-500">
        Acceso restringido al administrador de plataforma ({MASTER_DEV_EMAIL}).
      </p>
    )
  }

  async function handleCopyScript(id: string, sql: string) {
    const ok = await copyToClipboard(sql)
    if (ok) {
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(prev => (prev === id ? null : prev)), 2500)
    }
  }

  function handleDownloadScript(filename: string, sql: string) {
    const blob = new Blob([sql], { type: 'text/sql;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename.endsWith('.sql') ? filename : `${filename}.sql`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(url), 1500)
  }

  async function executeSqlInSupabase(scriptId: string, scriptTitle: string, sqlContent: string) {
    const clean = sqlContent.trim()
    if (!clean) {
      setFeedback({ ok: false, text: 'El contenido SQL está vacío.' })
      return
    }

    if (!isDemo && !isMasterAccount) {
      setFeedback({
        ok: false,
        text: `Por seguridad, solo la cuenta maestra ${MASTER_DEV_EMAIL} puede ejecutar scripts SQL desde la plataforma.`,
      })
      return
    }

    setExecuting(true)
    setFeedback(null)
    setBootstrapGuideVisible(false)

    try {
      // Vía 1: Si el servidor tiene SUPABASE_ACCESS_TOKEN configurado, puede ejecutar incluso el primer bootstrap
      if (connectedToReal && serverApiReady) {
        const { data: sessionData } = await supabase.auth.getSession()
        const jwt = sessionData?.session?.access_token
        if (jwt) {
          const resp = await fetch('/api/admin-sql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
              sql: clean,
              scriptId,
              scriptTitle,
            }),
          })
          const payload = (await resp.json()) as {
            ok?: boolean
            notConfigured?: boolean
            fallbackToRpc?: boolean
            error?: string
          }
          if (payload.ok) {
            setFeedback({
              ok: true,
              text: `Ejecutado directamente en Supabase (${supabaseHost || 'producción'}): ${scriptTitle}.`,
            })
            await checkDiagnostics()
            return
          }
          const isReadOnlyToken = /read-only transaction|25006|missing_permissions/i.test(
            payload.error || ''
          )
          if (!payload.notConfigured && !payload.fallbackToRpc && !isReadOnlyToken && payload.error) {
            throw new Error(payload.error)
          }
        }
      }

      // Vía 2: Función RPC blindada en Supabase (admin_ejecutar_migracion_sql)
      const { data, error } = await supabase.rpc('admin_ejecutar_migracion_sql', {
        p_sql: clean,
        p_script_id: scriptId,
        p_script_title: scriptTitle,
      })

      if (error) {
        if (
          /admin_ejecutar_migracion_sql|Could not find the function|does not exist|PGRST202/i.test(
            error.message || ''
          )
        ) {
          const consolidated = SQL_SCRIPT_BUNDLES.find(b => b.id === 'consolidated')
          if (consolidated) {
            await copyToClipboard(consolidated.sql)
            setCopiedId('consolidated')
          }
          setBootstrapGuideVisible(true)
          setFeedback({
            ok: false,
            text:
              'Falta activar por única vez el Motor SQL en tu Supabase. Ya copiamos el Paquete Consolidado Maestro a tu portapapeles: pégalo en Supabase SQL Editor → Run y desde ese instante podrás ejecutar futuros scripts en 1 clic aquí mismo.',
          })
          return
        }
        throw new Error(error.message)
      }

      const msg =
        (data as { message?: string } | null)?.message ||
        `Script "${scriptTitle}" ejecutado correctamente.`

      setFeedback({ ok: true, text: msg })
      await checkDiagnostics()
    } catch (err) {
      setFeedback({
        ok: false,
        text: err instanceof Error ? err.message : 'Error al ejecutar el script SQL.',
      })
    } finally {
      setExecuting(false)
    }
  }

  function isBundleInstalled(bundle: SqlScriptBundle): boolean {
    if (tableStatuses.length === 0 || bundle.targetTables.length === 0) return false
    return bundle.targetTables.every(tbl =>
      tableStatuses.some(s => s.name === tbl && s.installed)
    )
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Encabezado principal */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            Centro de Scripts SQL y Supabase
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Administra, audita, descarga y ejecuta todas las migraciones SQL de InventarioPro desde un único panel maestro.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void checkDiagnostics()}
            disabled={diagLoading}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
            Verificar conexión y tablas
          </button>

          <a
            href={sqlEditorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-medium text-white whitespace-nowrap shrink-0"
          >
            Abrir Supabase SQL Editor
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {/* Resumen de conexión y estado en tiempo real */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Estado de conexión</p>
          <p
            className={`text-base font-bold mt-1 truncate ${
              connectedToReal ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {connectedToReal ? 'Supabase Real conectado' : 'Entorno Demo / Sin llaves locales'}
          </p>
          <p className="text-xs text-slate-500 mt-1 font-mono truncate">
            {connectedToReal && supabaseHost
              ? supabaseHost
              : 'Credenciales reales activas al desplegar en Vercel'}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Tablas verificadas en esquema</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {diagLoading ? '…' : `${installedCount} / ${tableStatuses.length || PROBE_TABLES.length}`}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {pendingTables.length === 0
              ? 'Todas las tablas operativas están creadas'
              : `${pendingTables.length} pendientes de activar con SQL`}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Ejecución directa en 1 clic</p>
          <p
            className={`text-base font-bold mt-1 ${
              engineReady || serverApiReady ? 'text-emerald-700' : 'text-amber-700'
            }`}
          >
            {engineReady || serverApiReady ? 'Habilitada desde la web' : 'Requiere activación inicial'}
          </p>
          <p className="text-xs text-slate-500 mt-1 truncate">
            {pgVersion ? `PostgreSQL ${pgVersion}` : `Blindado para ${MASTER_DEV_EMAIL}`}
          </p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-medium text-slate-500">Scripts en biblioteca</p>
          <p className="text-2xl font-bold text-slate-900 mt-1 tabular-nums">
            {SQL_SCRIPT_BUNDLES.length}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            {logs.length} ejecuciones registradas en bitácora
          </p>
        </div>
      </div>

      {/* Guía rápida de activación por primera vez o cuando no hay credenciales en previsualización */}
      {(!connectedToReal || bootstrapGuideVisible || pendingTables.length > 0) && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                {!connectedToReal
                  ? 'Cómo aplicar los scripts en tu proyecto real de Supabase'
                  : 'Activación rápida de tablas pendientes y Motor SQL en 1 clic'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const consolidated = SQL_SCRIPT_BUNDLES[0]
                  void handleCopyScript(consolidated.id, consolidated.sql)
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white whitespace-nowrap shrink-0"
              >
                {copiedId === 'consolidated' ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copiedId === 'consolidated'
                  ? 'Consolidado copiado'
                  : '1. Copiar Consolidado Maestro'}
              </button>

              <a
                href={sqlEditorUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 whitespace-nowrap shrink-0"
              >
                2. Pegar en SQL Editor
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>

          <p className="text-xs text-slate-600 leading-relaxed">
            {!connectedToReal
              ? 'En este entorno de edición las llaves de tu Supabase viven en Vercel/GitHub, por lo que aquí ves la vista previa segura. Puedes copiar o descargar el «Paquete Consolidado Maestro» aquí mismo (o desde tu web desplegada en Vercel) y ejecutarlo una sola vez en Supabase → SQL Editor. Al incluir la migración 000017, dejará activado también el botón «Ejecutar en Supabase» directamente desde tu aplicación en Vercel.'
              : `Tablas por activar en este proyecto: ${pendingTables.map(t => t.name).join(', ')}. Ejecuta el Paquete Consolidado Maestro (100% idempotente, conserva todos tus datos actuales) para habilitarlas junto con la ejecución directa desde esta pantalla.`}
          </p>
        </div>
      )}

      {feedback && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs flex items-start gap-2.5 ${
            feedback.ok
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-700" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-700" />
          )}
          <span className="leading-relaxed">{feedback.text}</span>
        </div>
      )}

      {/* Selector de pestañas */}
      <div className="flex gap-1 p-1 bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('library')}
          className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
            tab === 'library'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <Database className="w-4 h-4" />
          Biblioteca de Scripts SQL
        </button>

        <button
          type="button"
          onClick={() => setTab('custom')}
          className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
            tab === 'custom'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <FileCode2 className="w-4 h-4" />
          Consola SQL Personalizada
        </button>

        <button
          type="button"
          onClick={() => setTab('schema')}
          className={`flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
            tab === 'schema'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`}
        >
          <History className="w-4 h-4" />
          Estado de Tablas y Bitácora
        </button>
      </div>

      {/* PESTAÑA 1: BIBLIOTECA DE SCRIPTS */}
      {tab === 'library' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Columna izquierda: lista de scripts */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-3.5 border-b border-slate-200">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Filtrar script, tabla o función..."
                  className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-slate-50 focus:bg-white text-xs text-slate-800 focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
              {filteredBundles.map(b => {
                const isSelected = b.id === activeBundle.id
                const installed = isBundleInstalled(b)
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className={`w-full text-left px-4 py-3.5 transition-colors ${
                      isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className={isSelected ? 'text-slate-300' : 'text-slate-500'}>
                        {b.category}
                      </span>
                      <span
                        className={`font-semibold ${
                          installed
                            ? isSelected
                              ? 'text-emerald-300'
                              : 'text-emerald-700'
                            : isSelected
                              ? 'text-amber-300'
                              : 'text-amber-700'
                        }`}
                      >
                        {installed ? 'Activo en BD' : 'Listo para aplicar'}
                      </span>
                    </div>

                    <p className="text-xs sm:text-sm font-semibold mt-1 leading-snug">
                      {b.title}
                    </p>
                    <p
                      className={`text-[11px] font-mono mt-1 truncate ${
                        isSelected ? 'text-slate-400' : 'text-slate-400'
                      }`}
                    >
                      {b.filename} · {b.sql.split('\n').length} líneas
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Columna derecha: detalle, acciones y visor SQL */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-4 border-b border-slate-100">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{activeBundle.category}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono truncate">{activeBundle.filename}</span>
                </div>
                <h2 className="text-base sm:text-lg font-bold text-slate-900 mt-1">
                  {activeBundle.title}
                </h2>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                  {activeBundle.summary}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={executing}
                  onClick={() =>
                    void executeSqlInSupabase(
                      activeBundle.id,
                      activeBundle.title,
                      activeBundle.sql
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  {executing
                    ? 'Ejecutando…'
                    : connectedToReal
                      ? 'Ejecutar en Supabase'
                      : 'Probar ejecución en Demo'}
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyScript(activeBundle.id, activeBundle.sql)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white whitespace-nowrap shrink-0"
                >
                  {copiedId === activeBundle.id ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedId === activeBundle.id ? 'SQL copiado' : 'Copiar SQL'}
                </button>

                <button
                  type="button"
                  onClick={() => handleDownloadScript(activeBundle.filename, activeBundle.sql)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Descargar .sql
                </button>
              </div>

              <span className="text-xs font-mono tabular-nums text-slate-400">
                {activeBundle.sql.split('\n').length} líneas ·{' '}
                {(activeBundle.sql.length / 1024).toFixed(1)} KB
              </span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span className="truncate">{activeBundle.filename}</span>
                <span>PostgreSQL / Supabase RLS</span>
              </div>
              <pre className="p-4 text-[11px] leading-relaxed text-slate-200 font-mono overflow-x-auto max-h-[460px] overflow-y-auto">
                {activeBundle.sql}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: CONSOLA SQL PERSONALIZADA */}
      {tab === 'custom' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Editor y Ejecutor de Scripts SQL Personalizados
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Escribe o pega cualquier migración, ajuste de índice o consulta DDL administrativa para ejecutarla en Supabase bajo tu sesión maestra ({MASTER_DEV_EMAIL}) o descargarla como archivo `.sql`.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Título para bitácora de migraciones
              </label>
              <input
                value={customTitle}
                onChange={e => setCustomTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm text-slate-800 focus:outline-none focus:border-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Nombre de archivo al descargar
              </label>
              <input
                value={customFilename}
                onChange={e => setCustomFilename(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs sm:text-sm font-mono text-slate-800 focus:outline-none focus:border-slate-600"
              />
            </div>
          </div>

          <textarea
            rows={14}
            value={customSql}
            onChange={e => setCustomSql(e.target.value)}
            spellCheck={false}
            className="w-full p-4 rounded-xl border border-slate-800 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed focus:outline-none focus:border-emerald-500"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={executing || !customSql.trim()}
              onClick={() =>
                void executeSqlInSupabase('custom', customTitle || 'Script manual', customSql)
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="w-3.5 h-3.5" />
              {executing ? 'Ejecutando…' : 'Ejecutar en Supabase'}
            </button>

            <button
              type="button"
              onClick={() => void handleCopyScript('custom', customSql)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              {copiedId === 'custom' ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedId === 'custom' ? 'Copiado' : 'Copiar SQL'}
            </button>

            <button
              type="button"
              onClick={() => handleDownloadScript(customFilename, customSql)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar .sql
            </button>
          </div>
        </div>
      )}

      {/* PESTAÑA 3: ESTADO DE TABLAS Y BITÁCORA */}
      {tab === 'schema' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Estado de tablas */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                <h2 className="text-sm font-bold text-slate-900">
                  Tablas del Esquema Público (`public.*`)
                </h2>
                <span className="text-xs text-slate-500 tabular-nums">
                  {installedCount}/{tableStatuses.length} activas
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {tableStatuses.map(t => (
                  <div
                    key={t.name}
                    className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-mono font-semibold text-slate-800 truncate">
                        public.{t.name}
                      </p>
                      <p className="text-slate-500 truncate">{t.label}</p>
                    </div>
                    <span
                      className={`font-semibold whitespace-nowrap shrink-0 ${
                        t.installed ? 'text-emerald-700' : 'text-amber-700'
                      }`}
                    >
                      {t.installed ? 'Instalada' : 'Pendiente SQL'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Estado de funciones RPC + Bitácora */}
            <div className="space-y-5">
              {rpcStatuses.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-slate-200">
                    <h2 className="text-sm font-bold text-slate-900">
                      Funciones RPC Críticas en PostgreSQL
                    </h2>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {rpcStatuses.map(r => (
                      <div
                        key={r.name}
                        className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-mono font-semibold text-slate-800 truncate">
                            {r.name}()
                          </p>
                          <p className="text-slate-500 truncate">{r.label}</p>
                        </div>
                        <span
                          className={`font-semibold whitespace-nowrap shrink-0 ${
                            r.installed ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {r.installed ? 'Activa' : 'Pendiente'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Bitácora de Migraciones Ejecutadas
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {logs.length} registros
                  </span>
                </div>

                {logs.length === 0 ? (
                  <p className="px-5 py-8 text-xs text-slate-400 text-center">
                    Aún no hay ejecuciones registradas en `public.sql_migration_log`.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                    {logs.map(l => (
                      <div key={l.id} className="px-5 py-3 text-xs space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900 truncate">
                            {l.script_title}
                          </span>
                          <span className="text-emerald-700 font-semibold whitespace-nowrap">
                            {l.status}
                          </span>
                        </div>
                        <p className="text-slate-500 tabular-nums">
                          {fmtDateTime(l.executed_at)} · {l.executed_email} ·{' '}
                          {l.statements_length} caracteres
                        </p>
                        {l.summary && <p className="text-slate-600">{l.summary}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
