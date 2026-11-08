BEGIN;

-- ============================================================
-- 000032: INVENTARIO AISLADO POR EMPRESA
-- Administrador central: acceso operativo solo a su empresa.
-- Gestores: conservan sus permisos empresariales.
-- Soporte: conserva autorización temporal y auditada.
-- ============================================================

-- 1. PREVALIDACIÓN

DO $$
BEGIN
  IF to_regprocedure('public.is_platform_admin()') IS NULL
     OR to_regprocedure('public.current_company_id()') IS NULL
     OR to_regprocedure('public.can_manage_inventory()') IS NULL THEN
    RAISE EXCEPTION 'Faltan funciones de autorización';
  END IF;

  IF to_regclass('public.inventory_transfer_items') IS NULL
     OR to_regclass('public.inventory_transfers') IS NULL THEN
    RAISE EXCEPTION 'Faltan tablas de traslados';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='inventory_transfer_items'
      AND column_name='company_id'
      AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='inventory_transfers'
      AND column_name='company_id'
      AND data_type='uuid'
  ) THEN
    RAISE EXCEPTION 'Falta company_id UUID en tablas de traslados';
  END IF;
END;
$$;

-- 2. CONSERVAR current_company_id()
-- No se modifica: debe seguir devolviendo la empresa del perfil.

-- 3. AUTORIZACIÓN DE INVENTARIO LIMITADA A LA EMPRESA PROPIA

CREATE OR REPLACE FUNCTION public.can_manage_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id=auth.uid()
        AND p.active=true
        AND p.company_id IS NOT NULL
        AND p.company_id=public.current_company_id()
        AND (
          public.is_platform_admin()
          OR (
            NOT public.is_platform_admin()
            AND p.role IN (
              'admin',
              'dueno',
              'admin_empresa',
              'gerente',
              'almacen'
            )
          )
        )
    );
$function$;

-- 4. DETALLES DE TRASLADOS: INSERT EN BORRADOR

DROP POLICY IF EXISTS inventory_transfer_items_insert_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_insert_draft
ON public.inventory_transfer_items
FOR INSERT TO authenticated
WITH CHECK (
  company_id=public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id=inventory_transfer_items.transfer_id
      AND t.company_id=inventory_transfer_items.company_id
      AND t.company_id=public.current_company_id()
      AND t.status='draft'
  )
);

-- 5. DETALLES DE TRASLADOS: UPDATE EN BORRADOR

DROP POLICY IF EXISTS inventory_transfer_items_update_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_update_draft
ON public.inventory_transfer_items
FOR UPDATE TO authenticated
USING (
  company_id=public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id=inventory_transfer_items.transfer_id
      AND t.company_id=inventory_transfer_items.company_id
      AND t.company_id=public.current_company_id()
      AND t.status='draft'
  )
)
WITH CHECK (
  company_id=public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id=inventory_transfer_items.transfer_id
      AND t.company_id=inventory_transfer_items.company_id
      AND t.company_id=public.current_company_id()
      AND t.status='draft'
  )
);

-- 6. DETALLES DE TRASLADOS: DELETE EN BORRADOR

DROP POLICY IF EXISTS inventory_transfer_items_delete_draft
ON public.inventory_transfer_items;

CREATE POLICY inventory_transfer_items_delete_draft
ON public.inventory_transfer_items
FOR DELETE TO authenticated
USING (
  company_id=public.current_company_id()
  AND public.can_manage_inventory()
  AND EXISTS (
    SELECT 1
    FROM public.inventory_transfers t
    WHERE t.id=inventory_transfer_items.transfer_id
      AND t.company_id=inventory_transfer_items.company_id
      AND t.company_id=public.current_company_id()
      AND t.status='draft'
  )
);

-- 7. VALIDACIONES

DO $$
BEGIN
  IF public.current_company_id() IS NULL
     AND public.is_platform_admin() THEN
    RAISE EXCEPTION
      'El administrador central no tiene empresa de prueba asignada';
  END IF;

  IF public.is_platform_admin()
     AND NOT public.can_manage_inventory() THEN
    RAISE EXCEPTION
      'El administrador central no tiene acceso a inventario en su empresa';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='inventory_transfer_items'
      AND policyname='inventory_transfer_items_insert_draft'
      AND cmd='INSERT'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='inventory_transfer_items'
      AND policyname='inventory_transfer_items_update_draft'
      AND cmd='UPDATE'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public'
      AND tablename='inventory_transfer_items'
      AND policyname='inventory_transfer_items_delete_draft'
      AND cmd='DELETE'
  ) THEN
    RAISE EXCEPTION 'Faltan políticas de traslados';
  END IF;
END;
$$;

COMMIT;
