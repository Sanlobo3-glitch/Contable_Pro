-- Consolidación contable y rendimiento (ya aplicada en Supabase el 2026-11-07)

-- 1) Retirar restos del intento contable anterior (apuntaban a tablas que no existen)
drop function if exists public.get_trial_balance(date, date);
drop function if exists public.verify_journal_entry_balance();

-- 2) Índice duplicado en sales (se conserva sales_company_seller_created)
drop index if exists public.idx_sales_company_seller_created;

-- 3) Índices de cobertura para claves foráneas sin índice (idempotente)
do $$
declare
  r record;
  v_cols text;
  v_name text;
begin
  for r in
    select c.oid as coid, c.conname, c.conrelid, c.conkey, cl.relname as tbl
    from pg_constraint c
    join pg_class cl on cl.oid = c.conrelid
    join pg_namespace ns on ns.oid = cl.relnamespace
    where c.contype = 'f'
      and ns.nspname = 'public'
      and cl.relkind = 'r'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] <@ c.conkey
          and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] @> c.conkey
      )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into v_cols
    from unnest(r.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = r.conrelid and a.attnum = k.attnum;

    v_name := 'idx_fk_' || left(r.tbl, 24) || '_' || left(r.conname, 24) || '_' || substr(md5(r.tbl || r.conname), 1, 6);

    execute format('create index if not exists %I on public.%I (%s)', v_name, r.tbl, v_cols);
  end loop;
end $$;
