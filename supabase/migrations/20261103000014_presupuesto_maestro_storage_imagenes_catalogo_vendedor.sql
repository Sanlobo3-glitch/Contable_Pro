-- =============================================================================
-- FASE 3: PRESUPUESTO MAESTRO CONSOLIDADO, STORAGE DE IMÁGENES REALES DE
-- PRODUCTO Y CATÁLOGO COMERCIAL PARA VENDEDORES / MOSTRADOR (POS)
-- Fecha: 2026-11-03
-- =============================================================================
-- Este script es 100% IDEMPOTENTE (puede ejecutarse varias veces sin riesgo).
-- Incluye:
--   1.Tabla y políticas completas de Presupuesto Maestro (`financial_budgets`),
--     clonación intermensual con factor de variación (`clonar_presupuesto_mes`)
--     y resumen ejecutivo servidor (`resumen_presupuesto_ejecucion`).
--   2. Columnas comerciales y de imagen real en `public.products`
--     (`image_url`, `description`, `featured`, `catalog_visible`) + RPC segura
--     `actualizar_imagen_producto`.
--   3. Bucket oficial en Supabase Storage (`product-images`) con políticas RLS
--     para carga autenticada por empresa y visualización rápida en POS/Catálogo.
--   4. Actualización del catálogo digital (`obtener_catalogo_publico`) con
--     descripciones comerciales, destacados y filtro de visibilidad.
-- =============================================================================

begin;

do $$
begin
  if to_regprocedure('public.current_company_id()') is null then
    execute $fn$
      create function public.current_company_id()
      returns uuid
      language sql
      stable
      security definer
      set search_path = pg_catalog, public, pg_temp
      as $body$
        select p.company_id
          from public.profiles p
         where p.id = auth.uid()
           and coalesce(p.active, true) = true
         limit 1;
      $body$;
    $fn$;
    execute 'grant execute on function public.current_company_id() to authenticated, service_role';
  end if;

  if to_regprocedure('public.my_company()') is null then
    execute $fn$
      create function public.my_company()
      returns uuid
      language sql
      stable
      security definer
      set search_path = pg_catalog, public, pg_temp
      as $body$
        select public.current_company_id();
      $body$;
    $fn$;
    execute 'grant execute on function public.my_company() to authenticated, service_role';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1. PRESUPUESTO MAESTRO MENSUAL Y POR SUCURSAL (`public.financial_budgets`)
-- -----------------------------------------------------------------------------
create table if not exists public.financial_budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.my_company() references public.companies(id) on delete cascade,
  period_month date not null,
  branch_id uuid null references public.branches(id) on delete set null,
  kind text not null check (kind in ('ingreso_ventas', 'costo_compras', 'gasto_operativo', 'nomina')),
  category_name text not null,
  budget_amount numeric(14,2) not null default 0 check (budget_amount >= 0),
  notes text null,
  created_by uuid null default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_financial_budgets_company_month
  on public.financial_budgets(company_id, period_month);

create index if not exists idx_financial_budgets_company_branch
  on public.financial_budgets(company_id, branch_id);

alter table public.financial_budgets enable row level security;

drop policy if exists financial_budgets_select on public.financial_budgets;
create policy financial_budgets_select on public.financial_budgets
  for select to authenticated
  using (company_id = public.my_company());

drop policy if exists financial_budgets_insert on public.financial_budgets;
create policy financial_budgets_insert on public.financial_budgets
  for insert to authenticated
  with check (
    company_id = public.my_company()
    and (
      public.is_manager()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.active = true
          and p.role in ('dueno', 'admin_empresa', 'gerente', 'contador', 'admin')
      )
    )
  );

drop policy if exists financial_budgets_update on public.financial_budgets;
create policy financial_budgets_update on public.financial_budgets
  for update to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_manager()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.active = true
          and p.role in ('dueno', 'admin_empresa', 'gerente', 'contador', 'admin')
      )
    )
  )
  with check (company_id = public.my_company());

drop policy if exists financial_budgets_delete on public.financial_budgets;
create policy financial_budgets_delete on public.financial_budgets
  for delete to authenticated
  using (
    company_id = public.my_company()
    and (
      public.is_manager()
      or exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.active = true
          and p.role in ('dueno', 'admin_empresa', 'gerente', 'contador', 'admin')
      )
    )
  );

create or replace function public.upsert_financial_budget(
  p_id uuid default null,
  p_period_month date default date_trunc('month', current_date)::date,
  p_branch_id uuid default null,
  p_kind text default 'gasto_operativo',
  p_category_name text default '',
  p_budget_amount numeric default 0,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_co uuid := public.my_company();
  v_month date := date_trunc('month', coalesce(p_period_month, current_date))::date;
  v_id uuid;
begin
  if v_co is null then
    raise exception 'Sesión sin empresa asociada';
  end if;

  if not (public.is_manager() or exists (
    select 1 from public.profiles where id = auth.uid() and active = true and role in ('contador', 'gerente', 'admin_empresa', 'dueno', 'admin')
  )) then
    raise exception 'No tienes permisos para gestionar presupuestos financieros';
  end if;

  if coalesce(trim(p_category_name), '') = '' then
    raise exception 'Indica la categoría o rubro presupuestario';
  end if;

  if p_kind not in ('ingreso_ventas', 'costo_compras', 'gasto_operativo', 'nomina') then
    raise exception 'Tipo de partida presupuestaria inválido';
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.company_id = v_co
  ) then
    raise exception 'La sucursal indicada no pertenece a tu empresa';
  end if;

  if p_id is not null then
    update public.financial_budgets
       set period_month = v_month,
           branch_id = p_branch_id,
           kind = p_kind,
           category_name = trim(p_category_name),
           budget_amount = round(greatest(0, coalesce(p_budget_amount, 0)), 2),
           notes = nullif(trim(coalesce(p_notes, '')), ''),
           updated_at = now()
     where id = p_id
       and company_id = v_co
    returning id into v_id;

    if v_id is null then
      raise exception 'Partida presupuestaria no encontrada';
    end if;
    return v_id;
  else
    insert into public.financial_budgets (
      company_id, period_month, branch_id, kind, category_name, budget_amount, notes, created_by
    ) values (
      v_co,
      v_month,
      p_branch_id,
      p_kind,
      trim(p_category_name),
      round(greatest(0, coalesce(p_budget_amount, 0)), 2),
      nullif(trim(coalesce(p_notes, '')), ''),
      auth.uid()
    )
    returning id into v_id;
    return v_id;
  end if;
end;
$$;

grant execute on function public.upsert_financial_budget(uuid, date, uuid, text, text, numeric, text) to authenticated;

create or replace function public.delete_financial_budget(p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_co uuid := public.my_company();
begin
  if not (public.is_manager() or exists (
    select 1 from public.profiles where id = auth.uid() and active = true and role in ('contador', 'gerente', 'admin_empresa', 'dueno', 'admin')
  )) then
    raise exception 'No tienes permisos para eliminar partidas presupuestarias';
  end if;

  delete from public.financial_budgets
   where id = p_id
     and company_id = v_co;
end;
$$;

grant execute on function public.delete_financial_budget(uuid) to authenticated;

-- Clonar partidas presupuestarias de un mes origen a un mes destino con ajuste %
create or replace function public.clonar_presupuesto_mes(
  p_source_month date,
  p_target_month date,
  p_variation_pct numeric default 0,
  p_overwrite boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_co uuid := public.my_company();
  v_src date := date_trunc('month', coalesce(p_source_month, current_date - interval '1 month'))::date;
  v_dst date := date_trunc('month', coalesce(p_target_month, current_date))::date;
  v_factor numeric := greatest(0, 1 + (coalesce(p_variation_pct, 0) / 100.0));
  v_copied int := 0;
begin
  if v_co is null then
    raise exception 'Sesión sin empresa asociada';
  end if;

  if not (public.is_manager() or exists (
    select 1 from public.profiles where id = auth.uid() and active = true and role in ('contador', 'gerente', 'admin_empresa', 'dueno', 'admin')
  )) then
    raise exception 'No tienes permisos para clonar presupuestos';
  end if;

  if v_src = v_dst then
    raise exception 'El mes origen y el mes destino deben ser distintos';
  end if;

  if p_overwrite then
    delete from public.financial_budgets
     where company_id = v_co
       and period_month = v_dst;
  end if;

  insert into public.financial_budgets (
    company_id, period_month, branch_id, kind, category_name, budget_amount, notes, created_by
  )
  select
    v_co,
    v_dst,
    src.branch_id,
    src.kind,
    src.category_name,
    round(greatest(0, src.budget_amount * v_factor), 2),
    case
      when coalesce(p_variation_pct, 0) <> 0
        then trim(coalesce(src.notes || ' · ', '') || 'Clonado ' || to_char(v_src, 'YYYY-MM') || ' (' || p_variation_pct || '%)')
      else trim(coalesce(src.notes || ' · ', '') || 'Clonado ' || to_char(v_src, 'YYYY-MM'))
    end,
    auth.uid()
  from public.financial_budgets src
  where src.company_id = v_co
    and src.period_month = v_src
    and not exists (
      select 1
      from public.financial_budgets ex
      where ex.company_id = v_co
        and ex.period_month = v_dst
        and coalesce(ex.branch_id, '00000000-0000-0000-0000-000000000000'::uuid) =
            coalesce(src.branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and ex.kind = src.kind
        and lower(trim(ex.category_name)) = lower(trim(src.category_name))
    );

  get diagnostics v_copied = row_count;
  return jsonb_build_object(
    'copied', v_copied,
    'source_month', v_src,
    'target_month', v_dst,
    'variation_pct', coalesce(p_variation_pct, 0)
  );
end;
$$;

grant execute on function public.clonar_presupuesto_mes(date, date, numeric, boolean) to authenticated;

-- Resumen consolidado de Presupuesto Maestro vs Ejecución Real
create or replace function public.resumen_presupuesto_ejecucion(
  p_period_month date default date_trunc('month', current_date)::date,
  p_branch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_co uuid := public.my_company();
  v_start date := date_trunc('month', coalesce(p_period_month, current_date))::date;
  v_end date := (v_start + interval '1 month')::date;
  v_sales numeric := 0;
  v_purchases numeric := 0;
  v_expenses numeric := 0;
  v_payroll numeric := 0;
  v_rev_target numeric := 0;
  v_out_target numeric := 0;
begin
  if v_co is null then
    raise exception 'Sesión sin empresa asociada';
  end if;

  select coalesce(sum(s.total), 0) into v_sales
    from public.sales s
   where s.company_id = v_co
     and s.status <> 'anulada'
     and s.created_at >= v_start::timestamptz
     and s.created_at < v_end::timestamptz
     and (p_branch_id is null or s.branch_id = p_branch_id);

  select coalesce(sum(p.total), 0) into v_purchases
    from public.purchases p
   where p.company_id = v_co
     and p.status <> 'anulada'
     and p.created_at >= v_start::timestamptz
     and p.created_at < v_end::timestamptz
     and (p_branch_id is null or p.branch_id = p_branch_id);

  select coalesce(sum(e.amount), 0) into v_expenses
    from public.expenses e
   where e.company_id = v_co
     and e.status <> 'anulado'
     and e.expense_date >= v_start
     and e.expense_date < v_end
     and (p_branch_id is null or e.branch_id = p_branch_id);

  if p_branch_id is null and to_regclass('public.payroll_payments') is not null then
    select coalesce(sum(pp.net_paid), 0) into v_payroll
      from public.payroll_payments pp
     where pp.company_id = v_co
       and pp.status <> 'anulado'
       and pp.payment_date >= v_start
       and pp.payment_date < v_end;
  end if;

  select
    coalesce(sum(case when fb.kind = 'ingreso_ventas' then fb.budget_amount else 0 end), 0),
    coalesce(sum(case when fb.kind <> 'ingreso_ventas' then fb.budget_amount else 0 end), 0)
    into v_rev_target, v_out_target
    from public.financial_budgets fb
   where fb.company_id = v_co
     and fb.period_month = v_start
     and (p_branch_id is null or fb.branch_id = p_branch_id);

  return jsonb_build_object(
    'period_month', v_start,
    'branch_id', p_branch_id,
    'revenue_target', round(v_rev_target, 2),
    'revenue_actual', round(v_sales, 2),
    'outflow_target', round(v_out_target, 2),
    'outflow_actual', round(v_purchases + v_expenses + v_payroll, 2),
    'purchases_actual', round(v_purchases, 2),
    'expenses_actual', round(v_expenses, 2),
    'payroll_actual', round(v_payroll, 2)
  );
end;
$$;

grant execute on function public.resumen_presupuesto_ejecucion(date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. METADATOS COMERCIALES E IMÁGENES REALES EN `public.products`
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists featured boolean not null default false,
  add column if not exists catalog_visible boolean not null default true;

create index if not exists idx_products_company_catalog_visible
  on public.products(company_id, catalog_visible, featured);

-- RPC para actualizar rápidamente la fotografía real desde Productos, POS o Catálogo
drop function if exists public.actualizar_imagen_producto(uuid, text);

create or replace function public.actualizar_imagen_producto(
  p_product_id uuid,
  p_image_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_co uuid := public.my_company();
  v_clean text := nullif(trim(coalesce(p_image_url, '')), '');
begin
  if v_co is null then
    raise exception 'Sesión sin empresa asociada';
  end if;

  if not (public.is_manager() or exists (
    select 1 from public.profiles
     where id = auth.uid()
       and coalesce(active, true) = true
       and role in ('dueno', 'admin_empresa', 'gerente', 'almacen', 'comprador', 'cajero', 'vendedor', 'admin')
  )) then
    raise exception 'No tienes permisos para cambiar fotografías del catálogo';
  end if;

  update public.products
     set image_url = v_clean
   where id = p_product_id
     and company_id = v_co;

  if not found then
    raise exception 'Producto no encontrado en tu empresa';
  end if;

  return jsonb_build_object('ok', true, 'product_id', p_product_id, 'image_url', v_clean);
end;
$$;

grant execute on function public.actualizar_imagen_producto(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. SUPABASE STORAGE: BUCKET PÚBLICO `product-images` CON RLS POR EMPRESA
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'product-images',
      'product-images',
      true,
      5242880,
      array['image/jpeg', 'image/png', 'image/webp']
    )
    on conflict (id) do update
      set public = true,
          file_size_limit = 5242880,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
  end if;
exception
  when insufficient_privilege then
    raise notice 'No se pudo configurar storage.buckets automáticamente; puedes crear el bucket público product-images desde el panel Storage.';
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists product_images_public_read on storage.objects;
    create policy product_images_public_read on storage.objects
      for select
      using (bucket_id = 'product-images');

    drop policy if exists product_images_auth_insert on storage.objects;
    create policy product_images_auth_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = public.my_company()::text
      );

    drop policy if exists product_images_auth_update on storage.objects;
    create policy product_images_auth_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = public.my_company()::text
      );

    drop policy if exists product_images_auth_delete on storage.objects;
    create policy product_images_auth_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = public.my_company()::text
      );
  end if;
exception
  when insufficient_privilege then
    raise notice 'Políticas de storage.objects requieren rol propietario en este proyecto; el sistema usará respaldo automático.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. CATÁLOGO DIGITAL PÚBLICO ENRIQUECIDO (`obtener_catalogo_publico`)
-- -----------------------------------------------------------------------------
create or replace function public.obtener_catalogo_publico(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_cfg record;
  v_products jsonb;
  v_categories jsonb;
begin
  if p_company_id is null then
    return jsonb_build_object('available', false, 'reason', 'Catálogo no especificado.');
  end if;

  select
    cc.company_id,
    coalesce(nullif(trim(cc.name), ''), c.name, 'Catálogo Digital') as name,
    cc.phone,
    cc.address,
    coalesce(nullif(trim(cc.currency), ''), 'USD') as currency,
    coalesce(cc.tax_rate, 0) as tax_rate,
    coalesce(cc.tax_mode, 'none') as tax_mode,
    coalesce(cc.catalog_enabled, true) as catalog_enabled,
    coalesce(cc.catalog_show_wholesale, true) as catalog_show_wholesale,
    coalesce(cc.catalog_show_stock, true) as catalog_show_stock,
    cc.catalog_welcome
  into v_cfg
  from public.companies c
  left join public.company_config cc on cc.company_id = c.id
  where c.id = p_company_id
  limit 1;

  if v_cfg.company_id is null then
    select
      cc.company_id,
      coalesce(nullif(trim(cc.name), ''), 'Catálogo Digital') as name,
      cc.phone,
      cc.address,
      coalesce(nullif(trim(cc.currency), ''), 'USD') as currency,
      coalesce(cc.tax_rate, 0) as tax_rate,
      coalesce(cc.tax_mode, 'none') as tax_mode,
      coalesce(cc.catalog_enabled, true) as catalog_enabled,
      coalesce(cc.catalog_show_wholesale, true) as catalog_show_wholesale,
      coalesce(cc.catalog_show_stock, true) as catalog_show_stock,
      cc.catalog_welcome
    into v_cfg
    from public.company_config cc
    where cc.company_id = p_company_id
    limit 1;
  end if;

  if v_cfg is null or v_cfg.company_id is null then
    return jsonb_build_object('available', false, 'reason', 'Catálogo no encontrado.');
  end if;

  if not v_cfg.catalog_enabled then
    return jsonb_build_object('available', false, 'reason', 'Este catálogo digital está desactivado temporalmente.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', cat.id,
    'name', cat.name
  ) order by cat.name), '[]'::jsonb)
  into v_categories
  from public.categories cat
  where cat.company_id = p_company_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'sku', coalesce(p.sku, ''),
    'description', p.description,
    'featured', coalesce(p.featured, false),
    'category_id', p.category_id,
    'category_name', cat.name,
    'price', round(coalesce(p.price, 0)::numeric, 2),
    'price_wholesale', case
      when v_cfg.catalog_show_wholesale and coalesce(p.price_wholesale, 0) > 0
        then round(p.price_wholesale::numeric, 2)
      else null
    end,
    'wholesale_min_qty', case
      when v_cfg.catalog_show_wholesale and coalesce(p.price_wholesale, 0) > 0 and coalesce(p.wholesale_min_qty, 0) > 0
        then p.wholesale_min_qty
      else null
    end,
    'unit', coalesce(nullif(trim(p.unit), ''), 'unidad'),
    'stock', case
      when v_cfg.catalog_show_stock then greatest(0, coalesce(p.stock, 0))
      else case when coalesce(p.stock, 0) > 0 then 1 else 0 end
    end,
    'in_stock', coalesce(p.stock, 0) > 0,
    'image_url', p.image_url
  ) order by coalesce(p.featured, false) desc, p.name asc), '[]'::jsonb)
  into v_products
  from public.products p
  left join public.categories cat on cat.id = p.category_id and cat.company_id = p.company_id
  where p.company_id = p_company_id
    and coalesce(p.catalog_visible, true) = true;

  return jsonb_build_object(
    'available', true,
    'company', jsonb_build_object(
      'company_id', p_company_id,
      'name', v_cfg.name,
      'phone', v_cfg.phone,
      'address', v_cfg.address,
      'currency', v_cfg.currency,
      'tax_rate', v_cfg.tax_rate,
      'tax_mode', v_cfg.tax_mode,
      'show_wholesale', v_cfg.catalog_show_wholesale,
      'show_stock', v_cfg.catalog_show_stock,
      'welcome', v_cfg.catalog_welcome
    ),
    'categories', v_categories,
    'products', v_products
  );
end;
$$;

grant execute on function public.obtener_catalogo_publico(uuid) to anon, authenticated;

commit;
