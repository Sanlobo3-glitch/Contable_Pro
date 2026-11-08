-- ============================================================================
-- 20261107000049 · REGISTRO ÚNICO DE MIGRACIONES (ya aplicada en Supabase el 2026-11-07)
-- Objetivo: que todo SQL ejecutado (desde la app, a mano o pegado en el SQL Editor) quede
-- registrado en public.sql_migration_log y que el Centro SQL muestre el estado real.
--   1) El motor SQL ya tolera BEGIN;/COMMIT; internos (paquetes con varios archivos).
--   2) admin_estado_objetos(): estado real de cualquier tabla/función para el Centro SQL.
--   3) sql_registrar_migracion(): pie de archivo que se auto-registra al ejecutarse.
--   4) admin_registrar_migracion_manual(): botón "marcar como aplicada" del Centro SQL.
--   5) La bitácora deja de ser escribible/truncable por usuarios autenticados.
--   6) Relleno verificado de las migraciones del repo que ya estaban aplicadas.
-- ============================================================================

-- 1) Motor SQL: ignora cualquier BEGIN;/COMMIT; suelto (error 0A000 al ejecutar un paquete consolidado)
CREATE OR REPLACE FUNCTION public.admin_ejecutar_migracion_sql(
  p_sql text,
  p_script_id text DEFAULT 'manual',
  p_script_title text DEFAULT 'Script administrativo',
  p_migration_file text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_jwt_email  text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile_email text;
  v_profile_role  text;
  v_clean      text;
  v_started    timestamptz := clock_timestamp();
  v_duration   integer;
  v_rows       integer := 0;
  v_log_id     uuid;
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

  -- PL/pgSQL ejecuta todo el cuerpo de forma atómica; EXECUTE no admite comandos de transacción.
  -- Se retira CUALQUIER línea suelta BEGIN; / START TRANSACTION; / COMMIT; (no solo la primera y la última).
  v_clean := regexp_replace(
    v_clean,
    '^[ \t]*(?:begin(?:[ \t]+transaction)?|start[ \t]+transaction|commit(?:[ \t]+transaction)?)[ \t]*;[ \t]*$',
    '', 'gni'
  );

  EXECUTE v_clean;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  v_duration := (EXTRACT(EPOCH FROM (clock_timestamp() - v_started)) * 1000)::integer;

  v_log_id := public.registrar_ejecucion_sql(
    p_script_id      => p_script_id,
    p_script_title   => p_script_title,
    p_sql            => v_clean,
    p_status         => 'aplicado',
    p_error_message  => NULL,
    p_duration_ms    => v_duration,
    p_source         => 'app_rpc',
    p_migration_file => p_migration_file,
    p_result_rows    => v_rows,
    p_executed_by    => v_uid,
    p_executed_email => v_profile_email,
    p_summary        => 'Ejecutado correctamente desde el panel SQL y caché de esquema recargado.'
  );

  PERFORM pg_notify('pgrst', 'reload schema');

  RETURN jsonb_build_object(
    'ok', true,
    'executed_at', now(),
    'script_id', coalesce(nullif(btrim(p_script_id), ''), 'manual'),
    'migration_file', p_migration_file,
    'duration_ms', v_duration,
    'log_id', v_log_id,
    'message', 'Script ejecutado correctamente y registrado en la bitácora.'
  );
END;
$function$;

-- 2) Estado real de tablas/funciones/registro (solo administración de plataforma)
CREATE OR REPLACE FUNCTION public.admin_estado_objetos(
  p_tables text[] DEFAULT '{}',
  p_functions text[] DEFAULT '{}'
)
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
  v_reg jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sesión requerida';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_uid AND p.active = true
      AND (p.role = 'admin' OR lower(btrim(coalesce(p.email, ''))) = 'sanlobo3@hotmail.com')
  ) INTO v_allowed;
  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Acceso restringido al administrador de plataforma';
  END IF;

  IF coalesce(array_length(p_tables, 1), 0) > 300 OR coalesce(array_length(p_functions, 1), 0) > 300 THEN
    RAISE EXCEPTION 'Demasiados objetos a verificar';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', x.n, 'label', x.n,
           'installed', to_regclass('public.' || quote_ident(x.n)) IS NOT NULL)), '[]'::jsonb)
    INTO v_tables
  FROM (SELECT DISTINCT n FROM unnest(p_tables) AS n WHERE n ~ '^[a-z0-9_]{1,63}$') x;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'name', x.n, 'label', x.n,
           'installed', EXISTS (
             SELECT 1 FROM pg_catalog.pg_proc pr
             JOIN pg_catalog.pg_namespace ns ON ns.oid = pr.pronamespace
             WHERE ns.nspname = 'public' AND pr.proname = x.n))), '[]'::jsonb)
    INTO v_rpcs
  FROM (SELECT DISTINCT n FROM unnest(p_functions) AS n WHERE n ~ '^[a-z0-9_]{1,63}$') x;

  SELECT jsonb_build_object(
           'script_ids', coalesce(jsonb_agg(DISTINCT script_id), '[]'::jsonb),
           'files', coalesce(jsonb_agg(DISTINCT migration_file) FILTER (WHERE migration_file IS NOT NULL), '[]'::jsonb))
    INTO v_reg
  FROM public.sql_migration_log
  WHERE status = 'aplicado';

  RETURN jsonb_build_object(
    'ok', true, 'checked_at', now(),
    'tables', v_tables, 'rpcs', v_rpcs, 'registered', v_reg
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_estado_objetos(text[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_estado_objetos(text[], text[]) TO authenticated;

-- 3) Pie de archivo: select public.sql_registrar_migracion('<archivo sin .sql>', '<título>', '<archivo.sql>');
CREATE OR REPLACE FUNCTION public.sql_registrar_migracion(
  p_script_id text,
  p_title text DEFAULT NULL,
  p_file text DEFAULT NULL,
  p_source text DEFAULT 'sql_editor_manual',
  p_summary text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_id uuid;
  v_sid text := left(coalesce(nullif(btrim(p_script_id), ''), ''), 120);
BEGIN
  IF v_sid = '' THEN
    RAISE EXCEPTION 'script_id requerido';
  END IF;

  -- Idempotente: si ya consta como aplicada, no duplica la fila.
  SELECT id INTO v_id
  FROM public.sql_migration_log
  WHERE script_id = v_sid AND status = 'aplicado'
  ORDER BY executed_at DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  RETURN public.registrar_ejecucion_sql(
    p_script_id      => v_sid,
    p_script_title   => coalesce(nullif(btrim(p_title), ''), v_sid),
    p_sql            => NULL,
    p_status         => 'aplicado',
    p_error_message  => NULL,
    p_duration_ms    => NULL,
    p_source         => coalesce(nullif(btrim(p_source), ''), 'sql_editor_manual'),
    p_migration_file => p_file,
    p_result_rows    => NULL,
    p_executed_by    => NULL,
    p_executed_email => NULL,
    p_summary        => coalesce(p_summary, 'Registrada por el pie del propio archivo al ejecutarse.')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.sql_registrar_migracion(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sql_registrar_migracion(text, text, text, text, text) TO service_role;

-- 4) Botón del Centro SQL: marcar como aplicada una migración ejecutada a mano
CREATE OR REPLACE FUNCTION public.admin_registrar_migracion_manual(
  p_script_id text,
  p_title text DEFAULT NULL,
  p_file text DEFAULT NULL,
  p_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión';
  END IF;

  SELECT lower(btrim(coalesce(p.email, ''))) INTO v_email
  FROM public.profiles p WHERE p.id = v_uid AND p.active = true;

  IF v_email IS DISTINCT FROM 'sanlobo3@hotmail.com' THEN
    RAISE EXCEPTION 'Seguridad: únicamente la cuenta maestra sanlobo3@hotmail.com puede registrar migraciones.';
  END IF;

  v_id := public.sql_registrar_migracion(
    p_script_id, p_title, p_file, 'app_manual',
    coalesce(p_summary, 'Marcada como aplicada manualmente desde el Centro SQL.')
  );
  RETURN jsonb_build_object('ok', true, 'log_id', v_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_registrar_migracion_manual(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_registrar_migracion_manual(text, text, text, text) TO authenticated;

-- 5) La bitácora solo se escribe vía funciones SECURITY DEFINER; los usuarios solo la leen (RLS: administración)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.sql_migration_log FROM authenticated, anon;

-- 6) Relleno verificado: migraciones del repo ya aplicadas (todos sus objetos existen en la base)
DO $backfill$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['20261029_2130_registrar_venta_pago_mixto','20261029_2131_baseline_registrar_visita','20261029_2132_baseline_registrar_abono','20261101000003_roles_y_admins','20261101000004_permisos_contabilidad','20261101000005_sucursales_y_bodegas','20261101000006_inventario_multibodega','20261101000007_kardex_movimientos','20261101_cuentas_por_pagar','20261101_gastos_y_devoluciones_completas','20261101_mejoras_compras_costo_promedio','20261101_vendedores_nomina_invitaciones_usuarios','20261102000008_traslados_bodegas','20261102000009_recepcion_parcial_traslados','20261102000010_reservas_inventario','20261102000011_inicializar_bodegas_inventario','20261102000012_ventas_por_bodega','20261102_liquidacion_nomina_despacho_rutas_catalogo_digital','20261102_seguridad_multidispositivo','20261102_seguridad_roles_empresa','20261103000013_tesoreria_centros_costo_ordenes_compra','20261103000014_presupuesto_maestro_storage_imagenes_catalogo_vendedor','20261103000015_tabla_imagenes_productos_y_sincronizacion_pos','20261103000016_rol_tecnico_soporte_sesiones_y_contador','20261103000017_centro_administracion_sql_supabase','20261103000018_ventas_catalogo_variantes_pagos_identidad','20261103000019_enlace_tienda_og_y_estudio_whatsapp','20261103000020_sincronizacion_automatica_marca_y_cache_whatsapp','20261104000021_cinco_soluciones_comerciales_avanzadas','20261105000001_separar_admin_global_y_manager_empresa','20261105000003_soporte_autorizaciones_auditoria','20261105000004_restringir_acceso_papeles_contables','20261105000005_restringir_acceso_solicitudes_soporte','20261105000006_soporte_lectura_modulo_productos','20261105000007_soporte_lectura_inventario','20261105000008_soporte_lectura_ventas_compras_gastos','20261105000009_soporte_lectura_terceros_ordenes_compra','20261105000010_revocar_privilegios_anon_compras_credito','20261105000011_soporte_lectura_cartera_cuentas_por_pagar','20261105000012_soporte_lectura_caja_gastos_tesoreria','20261105000013_soporte_lectura_contabilidad','20261105000014_soporte_lectura_nomina','20261105000015_soporte_lectura_dispositivos_sesiones','20261105000016_aislamiento_seguridad_modulo_ia','20261105000017_soporte_lectura_sucursales','20261105000018_soporte_lectura_categorias','20261105000019_aislar_configuracion_empresa','20261105000020_aislar_invitaciones_empresa','20261105000021_aislar_ubicaciones_clientes','20261105000022_aislar_metas_vendedores','20261105000023_proteger_datos_personales_empleados','20261105000024_aislar_registros_visitas_gps','20261105000025_aislar_configuracion_cxc','20261105000026_aislar_configuracion_cxp','20261105000027_aislar_empresas','20261105000028_aislar_auditoria_empresa','20261105000029_aislar_suscripciones_empresa','20261105000030_aislar_devoluciones_cotizaciones_y_rutas','20261105000031_aislar_perfiles_y_datos_personales','20261105000032_aislamiento_admin_plataforma_inventario','20261105000033_aislamiento_admin_soporte_inventario','20261105000034_soporte_admin_inventario_catalogo','20261105000035_habilitar_update_productos_authenticated','20261105000036_soporte_admin_company_config','20261105000037_aislamiento_admin_empresas_y_usuarios','20261105000038_aislamiento_funciones_admin_empresa_prueba','20261105000039_aislamiento_perfiles_y_autorizacion_soporte','20261105000040_restringir_ejecucion_anon_funciones_privilegiadas','20261105000041_ocultar_stock_exacto_verificacion_catalogo','20261105000042_restringir_acceso_directo_limites_planes','20261105000043_revocar_acceso_anon_inventario_multibodega','20261105000044_seguridad_pin_seguimiento_pedidos_catalogo','20261105000045_admin_global_comercial_y_equipo_plataforma','20261107000048_consolidar_contabilidad_acc_y_rendimiento'] LOOP
    PERFORM public.sql_registrar_migracion(
      s,
      initcap(replace(regexp_replace(s, '^[0-9]+(_[0-9]+)?_', ''), '_', ' ')),
      s || '.sql',
      'backfill_verificado',
      'Aplicada antes del registro único. Verificada por existencia de sus tablas/funciones en la base (2026-11-07).'
    );
  END LOOP;
END
$backfill$;

-- Pie de archivo (esta migración también se auto-registra)
SELECT public.sql_registrar_migracion(
  '20261107000049_registro_unico_migraciones',
  'Registro único de migraciones y motor SQL sin errores de transacción',
  '20261107000049_registro_unico_migraciones.sql'
);
