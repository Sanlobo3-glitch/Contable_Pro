-- ============================================================
-- 000032: AISLAMIENTO DEL ADMINISTRADOR CENTRAL EN INVENTARIO
-- Dependencia: funciones y tablas existentes de Contable_Pro.
--
-- El administrador de plataforma no obtiene acceso operativo
-- a una empresa por tener company_id en su perfil.
--
-- Se preservan los roles operativos de empresa.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. PREVALIDACIÓN
-- ------------------------------------------------------------

DO $$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NULL THEN
    RAISE EXCEPTION 'No existe public.is_platform_admin().';
  END IF;

  IF to_regprocedure('public.current_company_id()') IS NULL THEN
    RAISE EXCEPTION 'No existe public.current_company_id().';
  END IF;

  IF to_regprocedure('public.can_manage_inventory()') IS NULL THEN
    RAISE EXCEPTION 'No existe public.can_manage_inventory().';
  END IF;

  IF to_regclass('public.inventory_transfer_items') IS NULL
     OR to_regclass('public.inventory_transfers') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas de traslados de inventario.';
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 2. AISLAR current_company_id()
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    CASE
      WHEN public.is_platform_admin() THEN NULL::uuid
      ELSE (
        SELECT p.company_id
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.active = true
        LIMIT 1
      )
    END;
$function$;

-- ------------------------------------------------------------
-- 3. RESTRINGIR GESTIÓN DE INVENTARIO
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND NOT public.is_platform_admin()
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.active = true
        AND p.company_id IS NOT NULL
        AND p.role IN (
          'dueno',
          'admin_empresa',
          'gerente',
          'almacen'
        )
    );
$function$;

-- ------------------------------------------------------------
-- 4. CORREGIR VALIDACIÓN DE DETALLES DE TRASLADOS
-- ------------------------------------------------------------

DROP POLICY IF EXISTS inventory_transfer_items_insert_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_insert_draft
ON public.inventory_transfer_items
FOR INSERT
TO authenticated
WITH CHECK (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);

DROP POLICY IF EXISTS inventory_transfer_items_update_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_update_draft
ON public.inventory_transfer_items
FOR UPDATE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
)
WITH CHECK (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);

DROP POLICY IF EXISTS inventory_transfer_items_delete_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_delete_draft
ON public.inventory_transfer_items
FOR DELETE
TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id = inventory_transfer_items.transfer_id
      AND t.company_id = inventory_transfer_items.company_id
      AND t.company_id = public.current_company_id()
      AND t.status = 'draft'
  )
);

-- ------------------------------------------------------------
-- 5. VALIDACIONES DE SEGURIDAD
-- ------------------------------------------------------------

DO $$
DECLARE
  v_admin_company uuid;
BEGIN
  IF public.can_manage_inventory() THEN
    RAISE EXCEPTION
      'El usuario actual no debe obtener gestión de inventario como administrador central.';
  END IF;

  IF public.current_company_id() IS NOT NULL
     AND public.is_platform_admin() THEN
    RAISE EXCEPTION
      'El administrador central sigue obteniendo una empresa operativa.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_insert_draft'
      AND cmd = 'INSERT'
  ) THEN
    RAISE EXCEPTION
      'No quedó creada la política INSERT de detalles de traslados.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_update_draft'
      AND cmd = 'UPDATE'
  ) THEN
    RAISE EXCEPTION
      'No quedó creada la política UPDATE de detalles de traslados.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'inventory_transfer_items'
      AND policyname = 'inventory_transfer_items_delete_draft'
      AND cmd = 'DELETE'
  ) THEN
    RAISE EXCEPTION
      'No quedó creada la política DELETE de detalles de traslados.';
  END IF;
END;
$$;

COMMIT;
