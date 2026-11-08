
-- ============================================================
-- 000043: REVOCAR ACCESO ANONIMO A INVENTARIO MULTIBODEGA
-- ============================================================
-- El cliente anon no debe acceder directamente a:
-- transferencias, partidas, existencias por bodega ni bodegas.
--
-- Se conservan:
-- - Permisos CRUD de authenticated.
-- - Políticas RLS existentes.
-- - Acceso de service_role.
-- - Funciones internas y lógica de inventario.
-- ============================================================

BEGIN;

DO $validation$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'inventory_transfer_items',
        'inventory_transfers',
        'warehouse_stock',
        'warehouses'
    ]
    LOOP
        IF to_regclass('public.' || v_table) IS NULL THEN
            RAISE EXCEPTION 'No existe public.%', v_table;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relname = v_table
              AND c.relrowsecurity = true
        ) THEN
            RAISE EXCEPTION
                'RLS no está habilitado en public.%', v_table;
        END IF;
    END LOOP;
END;
$validation$;

-- Revocar exclusivamente al cliente anónimo.
REVOKE ALL PRIVILEGES
ON TABLE
    public.inventory_transfer_items,
    public.inventory_transfers,
    public.warehouse_stock,
    public.warehouses
FROM anon;

-- No modificar las políticas ni los permisos autenticados.
DO $validation$
DECLARE
    v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'inventory_transfer_items',
        'inventory_transfers',
        'warehouse_stock',
        'warehouses'
    ]
    LOOP
        IF
            has_table_privilege(
                'anon',
                'public.' || v_table,
                'SELECT'
            )
            OR has_table_privilege(
                'anon',
                'public.' || v_table,
                'INSERT'
            )
            OR has_table_privilege(
                'anon',
                'public.' || v_table,
                'UPDATE'
            )
            OR has_table_privilege(
                'anon',
                'public.' || v_table,
                'DELETE'
            )
        THEN
            RAISE EXCEPTION
                'anon conserva permisos CRUD en public.%', v_table;
        END IF;

        IF NOT (
            has_table_privilege(
                'authenticated',
                'public.' || v_table,
                'SELECT'
            )
            AND has_table_privilege(
                'authenticated',
                'public.' || v_table,
                'INSERT'
            )
            AND has_table_privilege(
                'authenticated',
                'public.' || v_table,
                'UPDATE'
            )
            AND has_table_privilege(
                'authenticated',
                'public.' || v_table,
                'DELETE'
            )
        ) THEN
            RAISE EXCEPTION
                'Se alteraron permisos CRUD de authenticated en public.%',
                v_table;
        END IF;
    END LOOP;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACION 000043
-- ============================================================
