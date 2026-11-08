
-- ============================================================
-- 000042: RESTRINGIR ACCESO DIRECTO A LIMITES DE PLANES
-- ============================================================
-- plan_limits se consulta desde funciones internas.
-- No requiere CRUD directo desde clientes.
-- Las funciones SECURITY DEFINER conservan su acceso
-- mediante los privilegios de su propietario.
-- ============================================================

BEGIN;

DO $validation$
BEGIN
    IF to_regclass('public.plan_limits') IS NULL THEN
        RAISE EXCEPTION 'No existe public.plan_limits';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = 'plan_limits'
          AND c.relrowsecurity = true
    ) THEN
        RAISE EXCEPTION
            'RLS debe permanecer habilitado en public.plan_limits';
    END IF;
END;
$validation$;

-- Eliminar permisos directos heredados o concedidos
-- explícitamente a los roles de clientes.
REVOKE ALL PRIVILEGES
ON TABLE public.plan_limits
FROM PUBLIC, anon, authenticated;

-- Mantener RLS activo.
ALTER TABLE public.plan_limits
ENABLE ROW LEVEL SECURITY;

-- Verificar que ningún acceso directo permanezca.
DO $validation$
BEGIN
    IF
        has_table_privilege('anon', 'public.plan_limits', 'SELECT')
        OR has_table_privilege('anon', 'public.plan_limits', 'INSERT')
        OR has_table_privilege('anon', 'public.plan_limits', 'UPDATE')
        OR has_table_privilege('anon', 'public.plan_limits', 'DELETE')
    THEN
        RAISE EXCEPTION
            'anon conserva permisos directos sobre plan_limits';
    END IF;

    IF
        has_table_privilege('authenticated', 'public.plan_limits', 'SELECT')
        OR has_table_privilege('authenticated', 'public.plan_limits', 'INSERT')
        OR has_table_privilege('authenticated', 'public.plan_limits', 'UPDATE')
        OR has_table_privilege('authenticated', 'public.plan_limits', 'DELETE')
    THEN
        RAISE EXCEPTION
            'authenticated conserva permisos directos sobre plan_limits';
    END IF;

    IF NOT has_table_privilege(
        'service_role',
        'public.plan_limits',
        'SELECT'
    ) THEN
        RAISE EXCEPTION
            'Se perdió el acceso SELECT de service_role';
    END IF;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000042
-- ============================================================
