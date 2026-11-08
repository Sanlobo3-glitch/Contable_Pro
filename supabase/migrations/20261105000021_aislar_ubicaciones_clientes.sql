
BEGIN;

-- ============================================================
-- 000021: AISLAMIENTO DE UBICACIONES DE CLIENTES
-- Administrador central: CRUD solo en su empresa actual.
-- Gestores: conserva sus cuatro políticas originales.
-- Integridad: cliente y ubicación deben pertenecer a la
-- misma empresa.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.customer_locations') IS NULL
     OR to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas requeridas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.customer_locations'::regclass
      AND relrowsecurity = TRUE
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.customers'::regclass
      AND relrowsecurity = TRUE
  ) THEN
    RAISE EXCEPTION 'RLS debe estar habilitado en ambas tablas';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_locations'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_locations'
      AND column_name = 'customer_id'
      AND data_type = 'uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'company_id'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Estructura UUID requerida no encontrada';
  END IF;

  IF to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
  THEN
    RAISE EXCEPTION 'Faltan funciones de seguridad';
  END IF;

  IF (
    SELECT count(*) FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND (
        (policyname = 'cl_select_managers' AND cmd = 'SELECT')
        OR (policyname = 'cl_insert_managers' AND cmd = 'INSERT')
        OR (policyname = 'cl_update_managers' AND cmd = 'UPDATE')
        OR (policyname = 'cl_delete_managers' AND cmd = 'DELETE')
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'No están presentes las cuatro políticas originales';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'platform_admin_all'
      AND cmd = 'ALL'
  ) THEN
    RAISE EXCEPTION 'No existe la política global esperada';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_locations cl
    LEFT JOIN public.customers c ON c.id = cl.customer_id
    WHERE c.id IS NULL
       OR c.company_id IS DISTINCT FROM cl.company_id
  ) THEN
    RAISE EXCEPTION
      'Hay ubicaciones huérfanas o asociadas a otra empresa';
  END IF;
END;
$$;

-- 1. Eliminar acceso global del administrador central.

DROP POLICY platform_admin_all
ON public.customer_locations;

-- 2. Administrador central: CRUD solo en su empresa.

DROP POLICY IF EXISTS platform_admin_company_all
ON public.customer_locations;

CREATE POLICY platform_admin_company_all
ON public.customer_locations
FOR ALL
TO authenticated
USING (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
)
WITH CHECK (
  public.is_platform_admin()
  AND company_id = (SELECT public.current_company_id())
);

-- 3. Validar correspondencia entre cliente y ubicación.
-- SECURITY INVOKER: respeta RLS de customers.

CREATE OR REPLACE FUNCTION public.enforce_customer_location_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_customer_company uuid;
BEGIN
  SELECT c.company_id
    INTO v_customer_company
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'El cliente indicado no existe o no es accesible'
      USING ERRCODE = '23503';
  END IF;

  IF v_customer_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'La ubicación y el cliente deben pertenecer a la misma empresa'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL
ON FUNCTION public.enforce_customer_location_company()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_customer_location_company
ON public.customer_locations;

CREATE TRIGGER trg_customer_location_company
BEFORE INSERT OR UPDATE OF customer_id, company_id
ON public.customer_locations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_customer_location_company();

-- 4. Permisos de tabla: RLS controla las filas.

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.customer_locations
TO authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.customer_locations
FROM anon;

-- 5. Verificaciones finales.

DO $$
DECLARE
  v_admin integer;
  v_global integer;
  v_manager integer;
BEGIN
  SELECT count(*) INTO v_admin
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'customer_locations'
    AND policyname = 'platform_admin_company_all'
    AND cmd = 'ALL'
    AND qual LIKE '%is_platform_admin()%'
    AND qual LIKE '%current_company_id()%'
    AND with_check LIKE '%is_platform_admin()%'
    AND with_check LIKE '%current_company_id()%';

  IF v_admin <> 1 THEN
    RAISE EXCEPTION 'Falta política CRUD central aislada';
  END IF;

  SELECT count(*) INTO v_global
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'customer_locations'
    AND policyname = 'platform_admin_all';

  IF v_global <> 0 THEN
    RAISE EXCEPTION 'Persiste acceso global';
  END IF;

  SELECT count(*) INTO v_manager
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'customer_locations'
    AND (
      (policyname = 'cl_select_managers' AND cmd = 'SELECT')
      OR (policyname = 'cl_insert_managers' AND cmd = 'INSERT')
      OR (policyname = 'cl_update_managers' AND cmd = 'UPDATE')
      OR (policyname = 'cl_delete_managers' AND cmd = 'DELETE')
    );

  IF v_manager <> 4 THEN
    RAISE EXCEPTION 'Se alteraron las políticas originales de gestores';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.customer_locations'::regclass
      AND tgname = 'trg_customer_location_company'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Falta trigger de validación';
  END IF;

  IF NOT has_table_privilege(
    'authenticated','public.customer_locations','SELECT'
  ) OR NOT has_table_privilege(
    'authenticated','public.customer_locations','INSERT'
  ) OR NOT has_table_privilege(
    'authenticated','public.customer_locations','UPDATE'
  ) OR NOT has_table_privilege(
    'authenticated','public.customer_locations','DELETE'
  ) THEN
    RAISE EXCEPTION 'Faltan permisos CRUD authenticated';
  END IF;

  IF has_table_privilege(
    'anon','public.customer_locations','SELECT'
  ) OR has_table_privilege(
    'anon','public.customer_locations','INSERT'
  ) OR has_table_privilege(
    'anon','public.customer_locations','UPDATE'
  ) OR has_table_privilege(
    'anon','public.customer_locations','DELETE'
  ) THEN
    RAISE EXCEPTION 'anon conserva permisos inesperados';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_locations cl
    LEFT JOIN public.customers c ON c.id = cl.customer_id
    WHERE c.id IS NULL
       OR c.company_id IS DISTINCT FROM cl.company_id
  ) THEN
    RAISE EXCEPTION 'Se detectaron ubicaciones inconsistentes';
  END IF;
END;
$$;

COMMIT;

