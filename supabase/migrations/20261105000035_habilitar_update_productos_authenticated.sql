

-- ============================================================
-- 000035: PERMITIR UPDATE DE PRODUCTOS A AUTHENTICATED
--
-- El acceso efectivo continúa limitado por las políticas RLS.
-- No concede acceso a otras empresas ni modifica el stock
-- mediante operaciones administrativas directas.
-- ============================================================

BEGIN;

GRANT UPDATE ON TABLE public.products TO authenticated;

DO $$
BEGIN
    IF NOT has_table_privilege(
        'authenticated',
        'public.products',
        'UPDATE'
    ) THEN
        RAISE EXCEPTION
            'No se pudo conceder UPDATE sobre products';
    END IF;

    IF NOT (
        SELECT relrowsecurity
        FROM pg_class
        WHERE oid = 'public.products'::regclass
    ) THEN
        RAISE EXCEPTION
            'RLS debe permanecer habilitado en products';
    END IF;
END;
$$;

COMMIT;
