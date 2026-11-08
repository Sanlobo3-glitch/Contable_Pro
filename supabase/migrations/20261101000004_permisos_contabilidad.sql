
BEGIN;

-- 1. Autorización de consulta contable
CREATE OR REPLACE FUNCTION public.can_view_accounting()
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
      AND p.company_id = public.current_company_id()
      AND p.role IN ('admin', 'dueno', 'contador')
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_accounting()
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.can_view_accounting()
TO authenticated, service_role;

-- 2. Reemplazar políticas de consulta contable
DROP POLICY IF EXISTS acc_accounts_select
ON public.acc_accounts;

CREATE POLICY acc_accounts_select
ON public.acc_accounts
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

DROP POLICY IF EXISTS acc_closings_select
ON public.acc_closings;

CREATE POLICY acc_closings_select
ON public.acc_closings
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

DROP POLICY IF EXISTS acc_entries_select
ON public.acc_entries;

CREATE POLICY acc_entries_select
ON public.acc_entries
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

DROP POLICY IF EXISTS acc_lines_select
ON public.acc_lines;

CREATE POLICY acc_lines_select
ON public.acc_lines
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

DROP POLICY IF EXISTS acc_periods_select
ON public.acc_periods;

CREATE POLICY acc_periods_select
ON public.acc_periods
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

DROP POLICY IF EXISTS acc_settings_select
ON public.acc_settings;

CREATE POLICY acc_settings_select
ON public.acc_settings
FOR SELECT TO authenticated
USING (
  company_id = public.current_company_id()
  AND public.can_view_accounting()
);

COMMIT;
