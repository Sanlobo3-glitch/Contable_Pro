
BEGIN;

-- =====================================================
-- 000021: AISLAMIENTO DE UBICACIONES DE CLIENTES
-- =====================================================

DO $$
BEGIN
  IF to_regclass('public.customer_locations') IS NULL
     OR to_regclass('public.customers') IS NULL THEN
    RAISE EXCEPTION 'Faltan las tablas requeridas';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'customer_locations'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS no está habilitado en customer_locations';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'cl_select_managers'
      AND cmd = 'SELECT'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'cl_insert_managers'
      AND cmd = 'INSERT'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'cl_update_managers'
      AND cmd = 'UPDATE'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'cl_delete_managers'
      AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'No están presentes todas las políticas originales de gestores';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
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
    LEFT JOIN public.customers c
      ON c.id = cl.customer_id
    WHERE c.id IS NULL
       OR c.company_id IS DISTINCT FROM cl.company_id
  ) THEN
    RAISE EXCEPTION
      'Hay ubicaciones huérfanas o asociadas a otra empresa. Revisar antes de continuar.';
  END IF;
END;
$$;

-- -----------------------------------------------------
-- 1. Eliminar el acceso global del administrador
-- -----------------------------------------------------

DROP POLICY platform_admin_all
ON public.customer_locations;

-- -----------------------------------------------------
-- 2. Validar que el cliente pertenezca a la empresa
-- -----------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_customer_location_company()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
  v_customer_company uuid;
BEGIN
  SELECT c.company_id
    INTO v_customer_company
  FROM public.customers c
  WHERE c.id = NEW.customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cliente indicado no existe o no es accesible'
      USING ERRCODE = '23503';
  END IF;

  IF v_customer_company IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION
      'La ubicación y el cliente deben pertenecer a la misma empresa'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

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

-- -----------------------------------------------------
-- 3. Verificaciones finales
-- -----------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname = 'platform_admin_all'
  ) THEN
    RAISE EXCEPTION 'Sigue existiendo el acceso global';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'customer_locations'
      AND policyname IN (
        'cl_select_managers',
        'cl_insert_managers',
        'cl_update_managers',
        'cl_delete_managers'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Se alteraron las políticas originales de gestores';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.customer_locations'::regclass
      AND tgname = 'trg_customer_location_company'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'No se creó el trigger de validación';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.customer_locations cl
    LEFT JOIN public.customers c
      ON c.id = cl.customer_id
    WHERE c.id IS NULL
       OR c.company_id IS DISTINCT FROM cl.company_id
  ) THEN
    RAISE EXCEPTION 'Se detectaron ubicaciones inconsistentes';
  END IF;
END;
$$;

COMMIT;
