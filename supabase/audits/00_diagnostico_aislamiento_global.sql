
-- ============================================================
-- INVENTARIO PRO
-- AUDITORIA 00: AISLAMIENTO DEL ADMINISTRADOR GLOBAL
-- Proyecto: Contable_Pro
-- Tipo: SOLO LECTURA
-- No modifica datos, funciones, permisos ni políticas.
-- Fecha: 2026-11-05
-- ============================================================

-- 1. RESUMEN DE POLITICAS RLS
SELECT
    count(*) AS total_policies,
    count(*) FILTER (
        WHERE policyname = 'platform_admin_all'
    ) AS global_admin_policies,
    count(DISTINCT tablename) FILTER (
        WHERE policyname = 'platform_admin_all'
    ) AS affected_tables
FROM pg_policies
WHERE schemaname = 'public';

-- 2. TABLAS CON ACCESO GLOBAL
SELECT
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname = 'platform_admin_all'
ORDER BY tablename;

-- 3. ROLES REGISTRADOS
SELECT
    role,
    count(*) AS total_users
FROM public.profiles
GROUP BY role
ORDER BY role;

-- 4. ROLES PERMITIDOS POR LA BASE DE DATOS
SELECT
    conname,
    pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype = 'c';

-- 5. FUNCIONES DE IDENTIDAD Y JERARQUIA
SELECT
    p.proname,
    pg_get_function_identity_arguments(p.oid) AS arguments,
    pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
      'is_platform_admin',
      'is_manager',
      'is_company_manager',
      'current_company_id',
      'my_company',
      '_my_role'
  )
ORDER BY p.proname;

-- 6. POLITICAS CON EXCEPCIONES GLOBALES O TECNICAS
SELECT
    tablename,
    policyname,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
      coalesce(qual, '') ILIKE '%is_platform_admin%'
      OR coalesce(with_check, '') ILIKE '%is_platform_admin%'
      OR coalesce(qual, '') ILIKE '%is_tech_support%'
      OR coalesce(with_check, '') ILIKE '%is_tech_support%'
  )
ORDER BY tablename, policyname;

-- 7. TABLAS RLS SIN POLITICAS
SELECT
    c.relname AS table_name,
    c.relrowsecurity AS rls_enabled,
    count(p.policyname) AS policy_count
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
    ON p.schemaname = n.nspname
   AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
GROUP BY c.relname, c.relrowsecurity
HAVING c.relrowsecurity = true
   AND count(p.policyname) = 0
ORDER BY c.relname;

-- FIN DE AUDITORIA 00
-- No ejecutar ninguna correccion desde este archivo.
