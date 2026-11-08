-- ============================================================
-- INVENTARIO PRO
-- AUDITORIA 01: PRIVILEGIOS Y FUNCIONES ESPECIALES
-- Proyecto: Contable_Pro
-- Tipo: SOLO LECTURA
-- No modifica datos, funciones, permisos ni políticas.
-- Fecha: 2026-11-05
-- ============================================================


-- 1. PRIVILEGIOS DIRECTOS SOBRE TABLAS SENSIBLES
-- Comprueba permisos de anon, authenticated y service_role.

SELECT
    c.relname AS tabla,
    c.relrowsecurity AS rls_habilitado,
    c.relforcerowsecurity AS rls_forzado,

    has_table_privilege('anon', c.oid, 'SELECT') AS anon_select,
    has_table_privilege('anon', c.oid, 'INSERT') AS anon_insert,
    has_table_privilege('anon', c.oid, 'UPDATE') AS anon_update,
    has_table_privilege('anon', c.oid, 'DELETE') AS anon_delete,
    has_table_privilege('anon', c.oid, 'TRUNCATE') AS anon_truncate,

    has_table_privilege('authenticated', c.oid, 'SELECT') AS auth_select,
    has_table_privilege('authenticated', c.oid, 'INSERT') AS auth_insert,
    has_table_privilege('authenticated', c.oid, 'UPDATE') AS auth_update,
    has_table_privilege('authenticated', c.oid, 'DELETE') AS auth_delete,
    has_table_privilege('authenticated', c.oid, 'TRUNCATE') AS auth_truncate,

    has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
    has_table_privilege('service_role', c.oid, 'INSERT') AS service_insert,
    has_table_privilege('service_role', c.oid, 'UPDATE') AS service_update,
    has_table_privilege('service_role', c.oid, 'DELETE') AS service_delete

FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname IN (
      'support_tickets',
      'plan_limits',
      'platform_admins',
      'profiles',
      'companies',
      'company_subscriptions',
      'subscriptions',
      'sql_migration_log'
  )
ORDER BY c.relname;


-- 2. FUNCIONES SECURITY DEFINER
-- Identifica funciones que se ejecutan con privilegios de su propietario.

SELECT
    p.oid::regprocedure AS funcion,
    pg_get_userbyid(p.proowner) AS propietario,
    p.prosecdef AS security_definer,
    p.provolatile AS volatilidad,
    p.proconfig AS configuracion,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ejecuta,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_ejecuta,
    pg_get_functiondef(p.oid) AS definicion

FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef = true
ORDER BY p.proname;


-- 3. FUNCIONES CRÍTICAS DE IDENTIDAD, SOPORTE Y ADMINISTRACIÓN

SELECT
    p.oid::regprocedure AS funcion,
    pg_get_userbyid(p.proowner) AS propietario,
    p.prosecdef AS security_definer,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ejecuta,
    pg_get_functiondef(p.oid) AS definicion

FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
      p.proname ILIKE '%support%'
      OR p.proname ILIKE '%tech%'
      OR p.proname ILIKE '%admin%'
      OR p.proname ILIKE '%migration%'
      OR p.proname ILIKE '%company%'
      OR p.proname ILIKE '%platform%'
  )
ORDER BY p.proname;


-- 4. POLÍTICAS DE LA TABLA DE SOPORTE
-- Revisa quién puede consultar, insertar, actualizar o eliminar tickets.

SELECT
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'support_tickets'
ORDER BY policyname;


-- 5. ESTRUCTURA DE AUTORIZACIÓN DE SOPORTE
-- Solo muestra nombres de columnas y restricciones.

SELECT
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'support_tickets'
ORDER BY ordinal_position;


-- 6. TRIGGERS DE LAS TABLAS SENSIBLES

SELECT
    c.relname AS tabla,
    t.tgname AS trigger_name,
    pg_get_triggerdef(t.oid) AS definicion,
    t.tgenabled AS estado
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND c.relname IN (
      'support_tickets',
      'platform_admins',
      'profiles',
      'companies',
      'sql_migration_log'
  )
ORDER BY c.relname, t.tgname;


-- 7. VISTAS PÚBLICAS Y CONFIGURACIÓN DE SEGURIDAD
-- Las vistas pueden requerir protección adicional frente a RLS.

SELECT
    schemaname,
    viewname,
    viewowner,
    definition
FROM pg_views
WHERE schemaname = 'public'
ORDER BY viewname;


-- 8. VISTAS CON OPCIONES DE SEGURIDAD
-- Permite identificar vistas configuradas como security_invoker.

SELECT
    c.relname AS vista,
    c.reloptions AS opciones
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'v'
ORDER BY c.relname;


-- 9. PERMISOS DE EJECUCIÓN SOBRE FUNCIONES CRÍTICAS

SELECT
    p.oid::regprocedure AS funcion,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_ejecuta,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_ejecuta,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_ejecuta
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'is_platform_admin',
      'is_manager',
      'is_company_manager',
      'is_tech_support',
      'current_company_id',
      'my_company',
      'admin_ejecutar_migracion_sql'
  )
ORDER BY p.proname;


-- FIN DE AUDITORIA 01
-- SOLO LECTURA.
-- NO EJECUTAR CORRECCIONES DESDE ESTE ARCHIVO.
