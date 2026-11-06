/**
 * Pasarela administrativa opcional para ejecución directa de SQL en Supabase
 * mediante Management API cuando SUPABASE_ACCESS_TOKEN está configurado en el servidor.
 *
 * Seguridad estricta:
 * 1. Exige token Bearer válido de Supabase Auth en el encabezado Authorization.
 * 2. Verifica contra Supabase Auth (/auth/v1/user) que el correo autenticado sea
 *    exclusivamente sanlobo3@hotmail.com.
 * 3. Jamás expone tokens en el cliente.
 */

export interface AdminSqlReq {
  method?: string
  url?: string
  query?: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
  body?: unknown
}

export interface AdminSqlRes {
  status(code: number): AdminSqlRes
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

const MASTER_ADMIN_EMAIL = 'sanlobo3@hotmail.com'

const DIAGNOSTIC_READ_SQL = `
SELECT jsonb_build_object(
  'pg_version', current_setting('server_version', true),
  'checked_at', now(),
  'tables', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', t.tbl,
        'label', t.lbl,
        'installed', to_regclass('public.' || t.tbl) IS NOT NULL
      )
    )
    FROM (
      VALUES
        ('profiles', 'Perfiles y roles de usuario'),
        ('member_profiles', 'Expedientes de personal y nómina'),
        ('branches', 'Sucursales y centros de costo'),
        ('warehouses', 'Bodegas multibodega'),
        ('purchase_orders', 'Órdenes de compra y recepción'),
        ('financial_budgets', 'Presupuesto maestro financiero'),
        ('product_images', 'Imágenes reales POS y catálogo PDF'),
        ('catalog_orders', 'Pedidos web de catálogo y captures de pago'),
        ('support_tickets', 'Soporte técnico y sesiones autorizadas'),
        ('cpa_working_papers', 'Papeles de trabajo y firma CPC'),
        ('accounts', 'Plan de cuentas jerárquico (accounts)'),
        ('journal_entries', 'Cabecera de asientos (journal_entries)'),
        ('journal_lines', 'Líneas contables (journal_lines)'),
        ('acc_accounts', 'Plan de cuentas contables legado'),
        ('acc_entries', 'Libro diario y comprobantes'),
        ('platform_staff', 'Equipo interno de plataforma (Migración 000045)'),
        ('platform_admin_audit', 'Auditoría comercial global (Migración 000045)'),
        ('sql_migration_log', 'Bitácora de migraciones SQL')
    ) AS t(tbl, lbl)
  ),
  'rpcs', (
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', r.fn_name,
        'label', r.lbl,
        'installed', EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc pr
          JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
          WHERE ns.nspname = 'public'
            AND pr.proname = r.fn_name
        )
      )
    )
    FROM (
      VALUES
        ('is_tech_support', 'Validador RLS de soporte técnico'),
        ('is_platform_staff', 'Validador de personal de plataforma (000045)'),
        ('admin_guardar_usuario_completo', 'Gestión integral de roles (11 perfiles)'),
        ('admin_listar_empresas_comerciales', 'Listado comercial multiempresa (000045)'),
        ('admin_activar_plan_empresa', 'Activación de planes por empresa (000045)'),
        ('admin_reactivar_prueba_empresa', 'Reactivación de prueba comercial (000045)'),
        ('admin_cambiar_estado_empresa', 'Suspensión/reactivación comercial (000045)'),
        ('admin_listar_equipo_plataforma', 'Listado de equipo de plataforma (000045)'),
        ('admin_asignar_personal_plataforma', 'Asignación de equipo de plataforma (000045)'),
        ('admin_estado_personal_plataforma', 'Estado de integrantes de plataforma (000045)'),
        ('admin_listar_auditoria_plataforma', 'Lectura de auditoría global (000045)'),
        ('actualizar_imagen_producto', 'Sincronización de imágenes POS/Catálogo'),
        ('obtener_catalogo_publico', 'Lectura pública de catálogo digital'),
        ('resolver_catalogo_publico', 'Resolución de enlace propio (/tienda/empresa)'),
        ('obtener_metadatos_enlace_tienda', 'Metadatos OpenGraph (Logo empresa en WhatsApp)'),
        ('verificar_stock_catalogo_publico', 'Verificación de stock en tiempo real (Catálogo)'),
        ('crear_pedido_catalogo_publico', 'Registro de pedidos públicos del catálogo'),
        ('gestionar_pedido_catalogo', 'Verificación de captures y ventas de catálogo'),
        ('acc_trial_balance', 'Motor de Hoja de Trabajo y Balance'),
        ('acc_reconcile', 'Conciliación Operación vs. Libros'),
        ('admin_ejecutar_migracion_sql', 'Ejecución SQL en 1 clic desde la web')
    ) AS r(fn_name, lbl)
  ),
  'public_tables_total', (
    SELECT count(*)::int
    FROM information_schema.tables it
    WHERE it.table_schema = 'public' AND it.table_type = 'BASE TABLE'
  )
) AS diag;
`

function extractProjectRef(supabaseUrl: string | undefined): string | null {
  const clean = (supabaseUrl || '').trim()
  if (!clean) return null
  try {
    const host = new URL(clean).hostname
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function getBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const raw = headers.authorization || headers.Authorization
  const val = Array.isArray(raw) ? raw[0] : raw
  if (!val) return null
  const m = val.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

function isVerifyQueryRequested(req: AdminSqlReq): boolean {
  const qVal = req.query?.verify
  if (qVal === '1' || qVal === 'true' || (Array.isArray(qVal) && qVal[0] === '1')) {
    return true
  }
  const rawUrl = req.url || ''
  return /[?&]verify=(1|true)\b/i.test(rawUrl)
}

export function createAdminSqlHandler(deps?: {
  fetchFn?: typeof fetch
  env?: Record<string, string | undefined>
}) {
  const fetchFn = deps?.fetchFn || globalThis.fetch.bind(globalThis)
  const getEnv = () => deps?.env || process.env

  return async function handleAdminSql(req: AdminSqlReq, res: AdminSqlRes): Promise<void> {
    const env = getEnv()
    const supabaseUrl = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '')
      .trim()
      .replace(/\/+(rest|auth|storage|functions|realtime)\/v1\/?$/i, '')
      .replace(/\/+$/, '')
    const supabaseAnonKey = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || '').trim()
    const managementToken = (env.SUPABASE_ACCESS_TOKEN || '').trim()
    const projectRef = (env.SUPABASE_PROJECT_REF || '').trim() || extractProjectRef(supabaseUrl)

    if (req.method === 'GET') {
      const configured = Boolean(managementToken && projectRef && supabaseUrl && supabaseAnonKey)

      if (!isVerifyQueryRequested(req) || !managementToken || !projectRef) {
        res.status(200).json({
          ok: true,
          serverSqlConfigured: configured,
          hasAccessToken: Boolean(managementToken),
          hasSupabaseUrl: Boolean(supabaseUrl),
          projectRef: projectRef || null,
        })
        return
      }

      try {
        const probeResp = await fetchFn(
          `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${managementToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: DIAGNOSTIC_READ_SQL }),
          }
        )

        const rawProbe = await probeResp.text()
        if (!probeResp.ok) {
          let errMsg = rawProbe
          try {
            const parsedErr = JSON.parse(rawProbe) as { message?: string; error?: string }
            errMsg = parsedErr.message || parsedErr.error || rawProbe
          } catch {
            /* ignore */
          }
          res.status(200).json({
            ok: true,
            serverSqlConfigured: configured,
            hasAccessToken: true,
            managementApiLive: false,
            managementApiError: errMsg || `HTTP ${probeResp.status}`,
            hasSupabaseUrl: Boolean(supabaseUrl),
            projectRef,
          })
          return
        }

        let diagPayload: Record<string, unknown> | null = null
        try {
          const rows = JSON.parse(rawProbe) as Array<{ diag?: Record<string, unknown> }>
          if (Array.isArray(rows) && rows[0]?.diag) {
            diagPayload = rows[0].diag
          }
        } catch {
          /* ignore */
        }

        res.status(200).json({
          ok: true,
          serverSqlConfigured: configured,
          hasAccessToken: true,
          managementApiLive: true,
          hasSupabaseUrl: Boolean(supabaseUrl),
          projectRef,
          diagnostics: diagPayload,
        })
        return
      } catch (err) {
        res.status(200).json({
          ok: true,
          serverSqlConfigured: configured,
          hasAccessToken: true,
          managementApiLive: false,
          managementApiError: err instanceof Error ? err.message : 'Error de red hacia Management API',
          hasSupabaseUrl: Boolean(supabaseUrl),
          projectRef,
        })
        return
      }
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Método no permitido' })
      return
    }

    if (!managementToken || !projectRef || !supabaseUrl || !supabaseAnonKey) {
      res.status(200).json({
        ok: false,
        notConfigured: true,
        error:
          'Ejecución directa por Management API no configurada en variables de servidor (SUPABASE_ACCESS_TOKEN).',
      })
      return
    }

    const userJwt = getBearerToken(req.headers)
    if (!userJwt) {
      res.status(401).json({ ok: false, error: 'Falta token de sesión de usuario.' })
      return
    }

    // Verificar identidad real contra Supabase Auth
    const authResp = await fetchFn(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${userJwt}`,
      },
    })

    if (!authResp.ok) {
      res.status(401).json({ ok: false, error: 'Sesión de Supabase inválida o expirada.' })
      return
    }

    const authUser = (await authResp.json()) as { id?: string; email?: string }
    const email = (authUser?.email || '').trim().toLowerCase()
    if (email !== MASTER_ADMIN_EMAIL) {
      res.status(403).json({
        ok: false,
        error: 'Acceso denegado: exclusivo para la cuenta maestra sanlobo3@hotmail.com.',
      })
      return
    }

    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as {
      sql?: string
      scriptId?: string
      scriptTitle?: string
    }
    const sql = (body.sql || '').trim()
    if (!sql) {
      res.status(400).json({ ok: false, error: 'El script SQL está vacío.' })
      return
    }

    const mgmtResp = await fetchFn(
      `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${managementToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      }
    )

    const rawText = await mgmtResp.text()
    if (!mgmtResp.ok) {
      let msg = rawText
      try {
        const parsed = JSON.parse(rawText) as { message?: string; error?: string }
        msg = parsed.message || parsed.error || rawText
      } catch {
        /* ignore */
      }

      // Si el SUPABASE_ACCESS_TOKEN es de solo lectura (25006 read-only transaction o 403),
      // delegar transparentemente a la función SECURITY DEFINER admin_ejecutar_migracion_sql con el JWT verificado de sanlobo3@hotmail.com
      if (/read-only transaction|25006|missing_permissions|database_write/i.test(msg || '') || mgmtResp.status === 403) {
        const rpcResp = await fetchFn(`${supabaseUrl}/rest/v1/rpc/admin_ejecutar_migracion_sql`, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${userJwt}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            p_sql: sql,
            p_script_id: body.scriptId || 'management_fallback',
            p_script_title: body.scriptTitle || 'Migración SQL InventarioPro',
          }),
        })
        const rpcRaw = await rpcResp.text()
        if (rpcResp.ok) {
          let rpcData: unknown = null
          try {
            rpcData = rpcRaw ? JSON.parse(rpcRaw) : null
          } catch {
            rpcData = rpcRaw
          }
          res.status(200).json({
            ok: true,
            via: 'rpc_security_definer',
            projectRef,
            result: rpcData,
          })
          return
        }
        res.status(200).json({
          ok: false,
          fallbackToRpc: true,
          error: msg || `Error HTTP ${mgmtResp.status}`,
        })
        return
      }

      res.status(400).json({ ok: false, error: msg || `Error HTTP ${mgmtResp.status}` })
      return
    }

    // Registrar en bitácora sql_migration_log si la tabla ya existe
    const safeId = (body.scriptId || 'management_api').replace(/'/g, "''").slice(0, 80)
    const safeTitle = (body.scriptTitle || 'Ejecución directa Management API')
      .replace(/'/g, "''")
      .slice(0, 180)
    const safeUserId =
      authUser?.id && /^[0-9a-f-]{36}$/i.test(authUser.id) ? `'${authUser.id}'::uuid` : 'NULL'
    const logSql = `
      DO $log$
      BEGIN
        IF to_regclass('public.sql_migration_log') IS NOT NULL THEN
          INSERT INTO public.sql_migration_log (
            script_id, script_title, executed_by, executed_email, status, summary, statements_length
          ) VALUES (
            '${safeId}',
            '${safeTitle}',
            ${safeUserId},
            '${MASTER_ADMIN_EMAIL}',
            'aplicado',
            'Aplicado vía Supabase Management API',
            ${sql.length}
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END $log$;
    `
    try {
      await fetchFn(
        `https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${managementToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: logSql }),
        }
      )
    } catch {
      /* ignore log failure */
    }

    let resultData: unknown = null
    try {
      resultData = rawText ? JSON.parse(rawText) : null
    } catch {
      resultData = rawText
    }

    res.status(200).json({
      ok: true,
      via: 'management_api',
      projectRef,
      result: resultData,
    })
  }
}

const defaultHandler = createAdminSqlHandler()

export default async function handler(req: AdminSqlReq, res: AdminSqlRes): Promise<void> {
  await defaultHandler(req, res)
}
