-- ============================================================================
-- INVENTARIOPRO · MIGRACIÓN 000017
-- Centro de Administración de Scripts SQL y Diagnóstico en Vivo de Supabase
-- Exclusivo para la cuenta maestra desarrolladora: sanlobo3@hotmail.com
-- 100% Idempotente · Permite ejecutar y auditar futuros scripts SQL desde la app
-- ============================================================================

BEGIN;

-- 1. Bitácora de migraciones y scripts ejecutados desde InventarioPro
CREATE TABLE IF NOT EXISTS public.sql_migration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id text NOT NULL,
  script_title text NOT NULL,
  executed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  executed_email text NOT NULL,
  status text NOT NULL DEFAULT 'aplicado'
    CHECK (status IN ('aplicado', 'error')),
  summary text,
  statements_length integer NOT NULL DEFAULT 0,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sql_migration_log_executed_at
  ON public.sql_migration_log (executed_at DESC);

ALTER TABLE public.sql_migration_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sql_migration_log FROM PUBLIC, anon;
GRANT SELECT ON public.sql_migration_log TO authenticated;

DROP POLICY IF EXISTS sql_migration_log_select_admin ON public.sql_migration_log;
CREATE POLICY sql_migration_log_select_admin
ON public.sql_migration_log
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND (
        p.role = 'admin'
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  )
);

-- 2. Diagnóstico en tiempo real del esquema PostgreSQL / Supabase
CREATE OR REPLACE FUNCTION public.admin_diagnostico_esquema()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed boolean := false;
  v_tables jsonb;
  v_rpcs jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = v_uid
      AND p.active = true
      AND (
        p.role = 'admin'
        OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com'
      )
  ) INTO v_allowed;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Acceso restringido al administrador de plataforma';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'name', t.tbl,
      'label', t.lbl,
      'installed', to_regclass('public.' || t.tbl) IS NOT NULL
    )
  )
  INTO v_tables
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
      ('acc_accounts', 'Plan de cuentas contables'),
      ('acc_entries', 'Libro diario y comprobantes'),
      ('sql_migration_log', 'Bitácora de migraciones SQL')
  ) AS t(tbl, lbl);

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
  INTO v_rpcs
  FROM (
    VALUES
      ('is_tech_support', 'Validador RLS de soporte técnico'),
      ('admin_guardar_usuario_completo', 'Gestión integral de roles (11 perfiles)'),
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
  ) AS r(fn_name, lbl);

  RETURN jsonb_build_object(
    'ok', true,
    'checked_at', now(),
    'pg_version', current_setting('server_version', true),
    'tables', coalesce(v_tables, '[]'::jsonb),
    'rpcs', coalesce(v_rpcs, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_diagnostico_esquema() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_diagnostico_esquema() TO authenticated, service_role;

-- 3. Motor de ejecución SQL administrativa en 1 clic (EXCLUSIVO sanlobo3@hotmail.com)
CREATE OR REPLACE FUNCTION public.admin_ejecutar_migracion_sql(
  p_sql text,
  p_script_id text DEFAULT 'manual',
  p_script_title text DEFAULT 'Script administrativo'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt_email text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile_email text;
  v_profile_role text;
  v_clean text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para ejecutar scripts SQL';
  END IF;

  SELECT lower(btrim(coalesce(p.email, ''))), p.role
  INTO v_profile_email, v_profile_role
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF v_profile_email IS DISTINCT FROM 'sanlobo3@hotmail.com'
     OR (v_jwt_email <> '' AND v_jwt_email <> 'sanlobo3@hotmail.com') THEN
    RAISE EXCEPTION 'Seguridad: únicamente la cuenta maestra sanlobo3@hotmail.com está autorizada para ejecutar migraciones SQL desde la plataforma.';
  END IF;

  v_clean := btrim(coalesce(p_sql, ''));
  IF v_clean = '' THEN
    RAISE EXCEPTION 'El contenido SQL está vacío';
  END IF;

  -- PL/pgSQL ya ejecuta todo el cuerpo de forma atómica en una transacción;
  -- retiramos únicamente envoltorios BEGIN; iniciales y COMMIT; finales de archivo.
  v_clean := regexp_replace(v_clean, '^\s*(?:--[^\n]*\n|\s)*BEGIN\s*;', '', 'i');
  v_clean := regexp_replace(v_clean, 'COMMIT\s*;\s*(?:--[^\n]*\s*)*$', '', 'i');

  EXECUTE v_clean;

  INSERT INTO public.sql_migration_log (
    script_id,
    script_title,
    executed_by,
    executed_email,
    status,
    summary,
    statements_length
  )
  VALUES (
    coalesce(nullif(btrim(p_script_id), ''), 'manual'),
    coalesce(nullif(btrim(p_script_title), ''), 'Script administrativo'),
    v_uid,
    v_profile_email,
    'aplicado',
    'Ejecutado correctamente y caché de esquema recargado.',
    length(v_clean)
  );

  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN jsonb_build_object(
    'ok', true,
    'executed_at', now(),
    'script_id', p_script_id,
    'message', 'Script SQL ejecutado en Supabase y esquema recargado.'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_ejecutar_migracion_sql(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ejecutar_migracion_sql(text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
