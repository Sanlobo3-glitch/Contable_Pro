-- ============================================================
-- INVENTARIOPRO · MIGRACIÓN 000049
-- BITÁCORA DE EJECUCIÓN SQL MANUAL CON TRAZABILIDAD COMPLETA
--
-- Objetivo:
--   1. Ampliar public.sql_migration_log para que registre QUÉ se
--      ejecutó (SQL + hash), si falló (error), cuánto tardó, desde
--      dónde se launched y a qué archivo del repositorio corresponde.
--   2. Exponer public.registrar_ejecucion_sql() para que el cliente
--      (app web / api/admin-sql) pueda registrar ejecuciones y
--      FALLOS en su propia transacción, de modo que un error quede
--      persistido aunque la transacción original se revierta.
--   3. Reescribir admin_ejecutar_migracion_sql() para que registre
--      el SQL real, el hash y la duración, y acepte el nombre del
--      archivo de migración asociado.
--   4. Reconstruir la bitácora con las migraciones ya aplicadas
--      desde supabase_migrations.schema_migrations, para que el
--      registro refleje la realidad de la base de datos.
--
-- No cambia ninguna tabla de negocio ni el flujo de ventas.
-- No modifica permisos de lectura existentes de la bitácora.
--
-- IMPORTANTE: aplicar a mano en el SQL Editor de Supabase.
-- NO usar `supabase db push` (ver AGENTS.md).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) AMPLIAR LA BITÁCORA
-- ------------------------------------------------------------

ALTER TABLE public.sql_migration_log
  ADD COLUMN IF NOT EXISTS sql_text       text,
  ADD COLUMN IF NOT EXISTS sql_hash       text,
  ADD COLUMN IF NOT EXISTS error_message  text,
  ADD COLUMN IF NOT EXISTS duration_ms    integer,
  ADD COLUMN IF NOT EXISTS source         text NOT NULL DEFAULT 'desconocido',
  ADD COLUMN IF NOT EXISTS migration_file text,
  ADD COLUMN IF NOT EXISTS result_rows    integer;

COMMENT ON COLUMN public.sql_migration_log.sql_text IS
  'Texto SQL exacto que se ejecutó (truncado a 200000 caracteres).';
COMMENT ON COLUMN public.sql_migration_log.sql_hash IS
  'SHA-256 del SQL ejecutado. Permite detectar si un script cambió entre ejecuciones.';
COMMENT ON COLUMN public.sql_migration_log.error_message IS
  'Mensaje de error cuando status = ''error''.';
COMMENT ON COLUMN public.sql_migration_log.duration_ms IS
  'Duración de la ejecución en milisegundos.';
COMMENT ON COLUMN public.sql_migration_log.source IS
  'Origen de la ejecución: app_rpc | management_api | sql_editor | api | manual.';
COMMENT ON COLUMN public.sql_migration_log.migration_file IS
  'Nombre del archivo .sql del repositorio al que corresponde esta ejecución.';

-- ------------------------------------------------------------
-- 2) FUNCIÓN DE REGISTRO (usable por el cliente)
-- ------------------------------------------------------------
-- Se invoca en una transacción independiente del script que se
-- audita, de modo que los FALLOS también quedan persistidos.

CREATE OR REPLACE FUNCTION public.registrar_ejecucion_sql(
  p_script_id       text DEFAULT 'manual',
  p_script_title    text DEFAULT 'Script administrativo',
  p_sql             text DEFAULT NULL,
  p_status          text DEFAULT 'aplicado',
  p_error_message   text DEFAULT NULL,
  p_duration_ms     integer DEFAULT NULL,
  p_source          text DEFAULT 'api',
  p_migration_file  text DEFAULT NULL,
  p_result_rows     integer DEFAULT NULL,
  p_executed_by     uuid DEFAULT NULL,
  p_executed_email  text DEFAULT NULL,
  p_summary         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_id     uuid;
  v_raw    text := coalesce(p_sql, '');
  v_len    integer := length(v_raw);
  v_sql    text := v_raw;
  v_hash   text := NULL;
  v_status text := lower(btrim(coalesce(p_status, 'aplicado')));
  v_by     uuid := p_executed_by;
  v_email  text := lower(btrim(coalesce(p_executed_email, '')));
BEGIN
  IF v_status NOT IN ('aplicado', 'error') THEN
    v_status := 'aplicado';
  END IF;

  IF v_raw <> '' THEN
    v_hash := encode(sha256(convert_to(v_raw, 'UTF8')), 'hex');
    IF v_len > 200000 THEN
      v_sql := left(v_raw, 200000) || E'\n-- [truncado: 200000 caracteres]';
    END IF;
  END IF;

  -- Si el llamador no indica identidad, se toma la de la sesión.
  IF v_by IS NULL AND auth.uid() IS NOT NULL THEN
    v_by := auth.uid();
  END IF;
  IF v_email = '' AND auth.jwt() ->> 'email' IS NOT NULL THEN
    v_email := lower(btrim(auth.jwt() ->> 'email'));
  END IF;

  INSERT INTO public.sql_migration_log (
    script_id,
    script_title,
    executed_by,
    executed_email,
    status,
    summary,
    statements_length,
    sql_text,
    sql_hash,
    error_message,
    duration_ms,
    source,
    migration_file,
    result_rows
  )
  VALUES (
    left(coalesce(nullif(btrim(p_script_id), ''), 'manual'), 120),
    left(coalesce(nullif(btrim(p_script_title), ''), 'Script administrativo'), 200),
    v_by,
    coalesce(nullif(v_email, ''), 'desconocido'),
    v_status,
    left(coalesce(p_summary, ''), 500),
    v_len,
    nullif(v_sql, ''),
    v_hash,
    nullif(left(coalesce(p_error_message, ''), 2000), ''),
    p_duration_ms,
    left(coalesce(nullif(btrim(p_source), ''), 'desconocido'), 40),
    nullif(left(coalesce(nullif(btrim(p_migration_file), ''), ''), 200), ''),
    p_result_rows
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_ejecucion_sql(
  text, text, text, text, text, integer, text, text, integer, uuid, text, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.registrar_ejecucion_sql(
  text, text, text, text, text, integer, text, text, integer, uuid, text, text
) TO service_role;

-- ------------------------------------------------------------
-- 2b) FUNCIÓN DE REGISTRO PARA EL USUARIO MAESTRO
-- ------------------------------------------------------------
-- El cliente web corre con una sesión `authenticated`, que no tiene
-- EXECUTE sobre registrar_ejecucion_sql (a propósito: nadie más que
-- el servidor debe poder escribir en la bitácora).
-- Esta función aplica la misma comprobación de cuenta maestra que
-- admin_ejecutar_migracion_sql y delega el registro.

CREATE OR REPLACE FUNCTION public.admin_registrar_ejecucion_sql(
  p_script_id      text DEFAULT 'manual',
  p_script_title   text DEFAULT 'Script administrativo',
  p_sql            text DEFAULT NULL,
  p_status         text DEFAULT 'aplicado',
  p_error_message  text DEFAULT NULL,
  p_source         text DEFAULT 'app_rpc',
  p_migration_file text DEFAULT NULL,
  p_duration_ms    integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_jwt_email     text := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  v_profile_email text;
  v_id            uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para registrar ejecuciones SQL';
  END IF;

  SELECT lower(btrim(coalesce(p.email, '')))
  INTO v_profile_email
  FROM public.profiles p
  WHERE p.id = v_uid
    AND p.active = true;

  IF v_profile_email IS DISTINCT FROM 'sanlobo3@hotmail.com'
     OR (v_jwt_email <> '' AND v_jwt_email <> 'sanlobo3@hotmail.com') THEN
    RAISE EXCEPTION 'Seguridad: únicamente la cuenta maestra sanlobo3@hotmail.com está autorizada.';
  END IF;

  v_id := public.registrar_ejecucion_sql(
    p_script_id      => p_script_id,
    p_script_title   => p_script_title,
    p_sql            => p_sql,
    p_status         => p_status,
    p_error_message  => p_error_message,
    p_duration_ms    => p_duration_ms,
    p_source         => p_source,
    p_migration_file => p_migration_file,
    p_executed_by    => v_uid,
    p_executed_email => v_profile_email
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_registrar_ejecucion_sql(
  text, text, text, text, text, text, text, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_registrar_ejecucion_sql(
  text, text, text, text, text, text, text, integer
) TO authenticated, service_role;

-- ------------------------------------------------------------
-- 3) MOTOR SQL: REGISTRA SQL REAL, HASH, DURACIÓN Y ARCHIVO
-- ------------------------------------------------------------
-- Nota sobre errores: cuando EXECUTE falla, PostgreSQL aborta la
-- transacción completa, por lo que un INSERT de bitácora hecho
-- dentro del handler EXCEPTION se perdería. Por eso el error lo
-- registra el CLIENTE (api/admin-sql.ts o la UI) llamando a
-- registrar_ejecucion_sql() en su propia transacción.

DROP FUNCTION IF EXISTS public.admin_ejecutar_migracion_sql(text, text, text);

CREATE OR REPLACE FUNCTION public.admin_ejecutar_migracion_sql(
  p_sql            text,
  p_script_id      text DEFAULT 'manual',
  p_script_title   text DEFAULT 'Script administrativo',
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

  -- PL/pgSQL ya ejecuta todo el cuerpo de forma atómica en una transacción;
  -- retiramos únicamente envoltorios BEGIN; iniciales y COMMIT; finales de archivo.
  v_clean := regexp_replace(v_clean, '^\s*(?:--[^\n]*\n|\s)*BEGIN\s*;', '', 'i');
  v_clean := regexp_replace(v_clean, 'COMMIT\s*;\s*(?:--[^\n]*\s*)*$', '', 'i');

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

REVOKE ALL ON FUNCTION public.admin_ejecutar_migracion_sql(text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ejecutar_migracion_sql(text, text, text, text)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 4) POLÍTICA DE INSERCIÓN PARA service_role
-- ------------------------------------------------------------

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sql_migration_log'
      AND policyname = 'sql_migration_log_insert_service'
  ) THEN
    EXECUTE 'CREATE POLICY sql_migration_log_insert_service
      ON public.sql_migration_log
      FOR INSERT
      TO service_role
      WITH CHECK (true)';
  END IF;
END;
$policy$;

-- ------------------------------------------------------------
-- 5) RECONSTRUIR LA BITÁCORA CON LO YA APLICADO
-- ------------------------------------------------------------
-- Las migraciones aplicadas por el SQL Editor de Supabase quedan
-- registradas en supabase_migrations.schema_migrations. Se copian a
-- la bitácora para que exista un registro único y consultable de
-- TODO lo que se ha aplicado en la base de datos.

INSERT INTO public.sql_migration_log (
  script_id,
  script_title,
  executed_by,
  executed_email,
  status,
  summary,
  statements_length,
  sql_text,
  sql_hash,
  duration_ms,
  source,
  migration_file,
  executed_at
)
SELECT
  m.name,
  'Migración aplicada: ' || m.name,
  NULL,
  coalesce(nullif(btrim(m.created_by), ''), 'desconocido'),
  'aplicado',
  'Registro reconstruido desde supabase_migrations.schema_migrations (historial de la base de datos).',
  length(m.v_text),
  m.v_text,
  encode(sha256(convert_to(m.v_text, 'UTF8')), 'hex'),
  NULL,
  'sql_editor',
  m.name,
  coalesce(
    to_timestamp(m.version::text, 'YYYYMMDDHH24MISS'),
    now()
  )
FROM (
  SELECT
    mm.name,
    mm.created_by,
    mm.version,
    (
      SELECT string_agg(s, chr(10))
      FROM unnest(coalesce(mm.statements, ARRAY[]::text[])) AS s
    ) AS v_text
  FROM supabase_migrations.schema_migrations mm
) m
WHERE m.name IS NOT NULL
  AND m.v_text IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.sql_migration_log l
    WHERE l.migration_file = m.name
      AND l.source = 'sql_editor'
  );

-- ------------------------------------------------------------
-- 6) VALIDACIONES
-- ------------------------------------------------------------

DO $validation$
DECLARE
  v_cols integer;
  v_rows integer;
BEGIN
  SELECT count(*)
  INTO v_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'sql_migration_log'
    AND column_name IN (
      'sql_text', 'sql_hash', 'error_message', 'duration_ms',
      'source', 'migration_file', 'result_rows'
    );

  IF v_cols <> 7 THEN
    RAISE EXCEPTION 'Faltan columnas en sql_migration_log (esperadas 7, encontradas %)', v_cols;
  END IF;

  IF to_regprocedure(
    'public.registrar_ejecucion_sql(text,text,text,text,text,integer,text,text,integer,uuid,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'No existe registrar_ejecucion_sql';
  END IF;

  IF to_regprocedure(
    'public.admin_ejecutar_migracion_sql(text,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'No existe admin_ejecutar_migracion_sql con 4 parámetros';
  END IF;

  IF to_regprocedure(
    'public.admin_registrar_ejecucion_sql(text,text,text,text,text,text,text,integer)'
  ) IS NULL THEN
    RAISE EXCEPTION 'No existe admin_registrar_ejecucion_sql';
  END IF;

  -- Sólo la cuenta maestra puede registrar desde el cliente.
  IF has_function_privilege(
    'anon',
    'public.admin_registrar_ejecucion_sql(text,text,text,text,text,text,text,integer)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon conserva ejecución de admin_registrar_ejecucion_sql';
  END IF;

  -- La versión anterior (3 parámetros) no debe seguir existiendo.
  IF to_regprocedure('public.admin_ejecutar_migracion_sql(text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Persiste la sobrecarga de admin_ejecutar_migracion_sql(text,text,text)';
  END IF;

  -- anon no debe poder registrar ni leer la bitácora.
  IF has_function_privilege(
    'anon',
    'public.registrar_ejecucion_sql(text,text,text,text,text,integer,text,text,integer,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon conserva ejecución de registrar_ejecucion_sql';
  END IF;

  IF has_table_privilege('anon', 'public.sql_migration_log', 'SELECT') THEN
    RAISE EXCEPTION 'anon conserva lectura de sql_migration_log';
  END IF;

  SELECT count(*)
  INTO v_rows
  FROM public.sql_migration_log;

  IF v_rows = 0 THEN
    RAISE EXCEPTION 'La bitácora quedó vacía: el backfill no se aplicó';
  END IF;

  RAISE NOTICE 'Bitácora con % registros', v_rows;
END;
$validation$;

COMMIT;

-- ============================================================
-- FIN MIGRACIÓN 000049
-- ============================================================
