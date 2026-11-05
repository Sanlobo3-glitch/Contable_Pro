
BEGIN;

-- 1. Ampliar los roles disponibles
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (
    role = ANY (
      ARRAY[
        'admin',
        'dueno',
        'admin_empresa',
        'gerente',
        'contador',
        'almacen',
        'vendedor',
        'transportador',
        'cajero',
        'comprador'
      ]::text[]
    )
  );

-- 2. Crear registro independiente de administradores
-- de plataforma. No se asigna ninguno automáticamente.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY
    REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES auth.users(id),
  notes text
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.platform_admins FROM PUBLIC, anon;
GRANT SELECT ON public.platform_admins TO authenticated;

DROP POLICY IF EXISTS platform_admins_read_self
  ON public.platform_admins;

CREATE POLICY platform_admins_read_self
ON public.platform_admins
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 3. Función para consultar autorización de plataforma
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    WHERE pa.user_id = auth.uid()
      AND pa.active = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_platform_admin()
TO authenticated, service_role;

-- 4. Preparar control de inventario
CREATE OR REPLACE FUNCTION public.can_manage_inventory()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.company_id IS NOT NULL
      AND p.role IN (
        'admin',
        'dueno',
        'admin_empresa',
        'gerente',
        'almacen'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_inventory()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_inventory()
TO authenticated, service_role;

-- 5. Función de acceso operativo a transporte
CREATE OR REPLACE FUNCTION public.can_manage_transport()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.active = true
      AND p.company_id IS NOT NULL
      AND p.role IN (
        'admin',
        'dueno',
        'admin_empresa',
        'gerente',
        'transportador'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_transport()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_manage_transport()
TO authenticated, service_role;

COMMIT;
