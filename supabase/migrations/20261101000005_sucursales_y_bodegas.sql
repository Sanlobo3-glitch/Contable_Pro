BEGIN;

-- =====================================================
-- 1. SUCURSALES
-- =====================================================

CREATE TABLE IF NOT EXISTS public.branches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text,
    address text,
    phone text,
    email text,
    is_main boolean NOT NULL DEFAULT false,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- IMPORTANTE: crear esta unicidad ANTES de warehouses.
CREATE UNIQUE INDEX IF NOT EXISTS branches_id_company_uidx
ON public.branches(id, company_id);

CREATE UNIQUE INDEX IF NOT EXISTS branches_company_code_uidx
ON public.branches(company_id, code)
WHERE code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS branches_one_main_per_company_uidx
ON public.branches(company_id)
WHERE is_main = true;

CREATE INDEX IF NOT EXISTS branches_company_idx
ON public.branches(company_id);


-- =====================================================
-- 2. BODEGAS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.warehouses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    branch_id uuid,
    name text NOT NULL,
    code text,
    address text,

    warehouse_type text NOT NULL DEFAULT 'general'
        CHECK (
            warehouse_type IN (
                'general',
                'principal',
                'materia_prima',
                'producto_terminado',
                'transito',
                'devoluciones'
            )
        ),

    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT warehouses_branch_company_fk
        FOREIGN KEY (branch_id, company_id)
        REFERENCES public.branches(id, company_id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_id_company_uidx
ON public.warehouses(id, company_id);

CREATE UNIQUE INDEX IF NOT EXISTS warehouses_company_code_uidx
ON public.warehouses(company_id, code)
WHERE code IS NOT NULL;

CREATE INDEX IF NOT EXISTS warehouses_company_idx
ON public.warehouses(company_id);

CREATE INDEX IF NOT EXISTS warehouses_branch_idx
ON public.warehouses(branch_id);


-- =====================================================
-- 3. SEGURIDAD RLS: SUCURSALES
-- =====================================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS branches_company_access ON public.branches;

CREATE POLICY branches_company_access
ON public.branches
FOR ALL
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public._my_role() IN (
        'admin',
        'dueno',
        'admin_empresa',
        'gerente'
    )
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public._my_role() IN (
        'admin',
        'dueno',
        'admin_empresa',
        'gerente'
    )
);


-- =====================================================
-- 4. SEGURIDAD RLS: BODEGAS
-- =====================================================

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS warehouses_company_access ON public.warehouses;

CREATE POLICY warehouses_company_access
ON public.warehouses
FOR ALL
TO authenticated
USING (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
)
WITH CHECK (
    company_id = public.current_company_id()
    AND public.can_manage_inventory()
);


-- =====================================================
-- 5. REALTIME
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_publication
        WHERE pubname = 'supabase_realtime'
    ) THEN

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'branches'
        ) THEN
            ALTER PUBLICATION supabase_realtime
            ADD TABLE public.branches;
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = 'warehouses'
        ) THEN
            ALTER PUBLICATION supabase_realtime
            ADD TABLE public.warehouses;
        END IF;

    END IF;
END $$;

COMMIT;
