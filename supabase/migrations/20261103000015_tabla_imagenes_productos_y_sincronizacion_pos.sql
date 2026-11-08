-- =============================================================================
-- INVENTARIOPRO · TABLA DEDICADA DE IMÁGENES DE PRODUCTOS (`product_images`)
-- Y CONEXIÓN BIDIRECCIONAL CON POS (MOSTRADOR), PRODUCTOS Y CATÁLOGO PDF
-- Fecha: 2026-11-03
-- =============================================================================
-- Script 100% IDEMPOTENTE (seguro de ejecutar varias veces en Supabase SQL Editor).
-- Qué resuelve y garantiza:
--   1. Compatibilidad total entre `public.current_company_id()` y `public.my_company()`.
--   2. Tabla dedicada `public.product_images` con aislamiento multiempresa (RLS),
--      historial de quién actualizó la imagen y respaldo automático en `public.products.image_url`.
--   3. Permisos explícitos (`GRANT`) a nivel de tabla y columnas comerciales de `products`
--      (`image_url`, `description`, `featured`, `catalog_visible`).
--   4. Trigger automático `trg_sync_product_images_to_products` para mantener siempre
--      sincronizada la tabla `product_images` con `products.image_url`.
--   5. Función segura `public.actualizar_imagen_producto(uuid, text)` (SECURITY DEFINER)
--      conectada con Mostrador (POS), Productos y Catálogo Comercial (retorna confirmación JSON).
--   6. Bucket público `product-images` en Supabase Storage + `obtener_catalogo_publico`
--      leyendo tanto `products.image_url` como `product_images.image_url`.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. FUNCIONES AUXILIARES DE EMPRESA (GARANTIZAR EXISTENCIA Y COMPATIBILIDAD)
-- -----------------------------------------------------------------------------
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
-- 1. COLUMNAS COMERCIALES Y DE FOTOGRAFÍA EN `public.products` + PERMISOS
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists image_url text,
  add column if not exists description text,
  add column if not exists featured boolean not null default false,
  add column if not exists catalog_visible boolean not null default true;

create index if not exists idx_products_company_catalog_visible
  on public.products(company_id, catalog_visible, featured);

-- Si la base usa privilegios de actualización por columna, habilitamos las columnas comerciales
do $$
begin
  execute 'grant update (image_url, description, featured, catalog_visible) on public.products to authenticated';
exception
  when others then null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. TABLA DEDICADA `public.product_images` CON RLS Y SINCRONIZACIÓN AUTOMÁTICA
-- -----------------------------------------------------------------------------
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  storage_path text null,
  mime_type text not null default 'image/jpeg',
  updated_by uuid null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_images_product_uidx unique (product_id)
);

create index if not exists idx_product_images_company
  on public.product_images(company_id, product_id);

alter table public.product_images enable row level security;

revoke all on public.product_images from public, anon;
grant select, insert, update, delete on public.product_images to authenticated, service_role;

drop policy if exists product_images_select on public.product_images;
create policy product_images_select on public.product_images
  for select to authenticated
  using (company_id = public.current_company_id());

drop policy if exists product_images_insert on public.product_images;
create policy product_images_insert on public.product_images
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and exists (
      select 1
        from public.profiles p
       where p.id = auth.uid()
         and coalesce(p.active, true) = true
         and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'almacen', 'comprador', 'cajero', 'vendedor')
    )
  );

drop policy if exists product_images_update on public.product_images;
create policy product_images_update on public.product_images
  for update to authenticated
  using (
    company_id = public.current_company_id()
    and exists (
      select 1
        from public.profiles p
       where p.id = auth.uid()
         and coalesce(p.active, true) = true
         and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'almacen', 'comprador', 'cajero', 'vendedor')
    )
  )
  with check (company_id = public.current_company_id());

drop policy if exists product_images_delete on public.product_images;
create policy product_images_delete on public.product_images
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and exists (
      select 1
        from public.profiles p
       where p.id = auth.uid()
         and coalesce(p.active, true) = true
         and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'almacen', 'comprador', 'cajero', 'vendedor')
    )
  );

-- Trigger bidireccional: al guardar o eliminar en `product_images`, refleja en `products.image_url`
create or replace function public._sync_product_image_to_product()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    update public.products
       set image_url = null
     where id = old.product_id
       and company_id = old.company_id
       and image_url is not null;
    return old;
  else
    update public.products
       set image_url = new.image_url
     where id = new.product_id
       and company_id = new.company_id
       and coalesce(image_url, '') is distinct from coalesce(new.image_url, '');
    return new;
  end if;
end;
$$;

drop trigger if exists trg_sync_product_images_to_products on public.product_images;
create trigger trg_sync_product_images_to_products
  after insert or update or delete on public.product_images
  for each row execute function public._sync_product_image_to_product();

-- Relleno inicial: si ya existían productos con `image_url`, copiarlos a `product_images`
insert into public.product_images (company_id, product_id, image_url, updated_at)
select p.company_id, p.id, trim(p.image_url), now()
  from public.products p
 where p.company_id is not null
   and coalesce(trim(p.image_url), '') <> ''
on conflict (product_id) do update
   set image_url = excluded.image_url,
       updated_at = now();

-- -----------------------------------------------------------------------------
-- 3. RPC OFICIAL `public.actualizar_imagen_producto` (POS, PRODUCTOS Y CATÁLOGO)
-- -----------------------------------------------------------------------------
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
  v_co uuid := coalesce(
    public.current_company_id(),
    (select company_id from public.profiles where id = auth.uid() and coalesce(active, true) = true limit 1)
  );
  v_clean text := nullif(trim(coalesce(p_image_url, '')), '');
  v_exists boolean := false;
begin
  if v_co is null then
    raise exception 'Sesión sin empresa asociada';
  end if;

  if not exists (
    select 1
      from public.profiles p
     where p.id = auth.uid()
       and coalesce(p.active, true) = true
       and p.company_id = v_co
       and p.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'almacen', 'comprador', 'cajero', 'vendedor')
  ) then
    raise exception 'No tienes permisos para actualizar fotografías de productos';
  end if;

  select exists (
    select 1 from public.products pr where pr.id = p_product_id and pr.company_id = v_co
  ) into v_exists;

  if not v_exists then
    raise exception 'El producto indicado no pertenece a tu empresa';
  end if;

  if v_clean is null then
    delete from public.product_images
     where product_id = p_product_id
       and company_id = v_co;

    update public.products
       set image_url = null
     where id = p_product_id
       and company_id = v_co;
  else
    insert into public.product_images (company_id, product_id, image_url, updated_by, updated_at)
    values (v_co, p_product_id, v_clean, auth.uid(), now())
    on conflict (product_id) do update
      set image_url = excluded.image_url,
          updated_by = auth.uid(),
          updated_at = now();

    update public.products
       set image_url = v_clean
     where id = p_product_id
       and company_id = v_co;
  end if;

  return jsonb_build_object(
    'ok', true,
    'product_id', p_product_id,
    'image_url', v_clean
  );
end;
$$;

revoke all on function public.actualizar_imagen_producto(uuid, text) from public, anon;
grant execute on function public.actualizar_imagen_producto(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. BUCKET PÚBLICO `product-images` EN SUPABASE STORAGE (CON RESPALDO SEGURO)
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
  when others then
    raise notice 'Bucket product-images omitido por permisos del rol SQL; la tabla product_images almacenará la foto comprimida directamente.';
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
        and (storage.foldername(name))[1] = public.current_company_id()::text
      );

    drop policy if exists product_images_auth_update on storage.objects;
    create policy product_images_auth_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = public.current_company_id()::text
      );

    drop policy if exists product_images_auth_delete on storage.objects;
    create policy product_images_auth_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'product-images'
        and (storage.foldername(name))[1] = public.current_company_id()::text
      );
  end if;
exception
  when others then
    raise notice 'Políticas de storage.objects requieren propietario del esquema storage; el sistema verificará acceso público y usará respaldo directo en product_images.';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. CATÁLOGO DIGITAL PÚBLICO CONECTADO A `products` + `product_images`
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
    'image_url', coalesce(nullif(trim(p.image_url), ''), pi.image_url)
  ) order by coalesce(p.featured, false) desc, p.name asc), '[]'::jsonb)
  into v_products
  from public.products p
  left join public.categories cat on cat.id = p.category_id and cat.company_id = p.company_id
  left join public.product_images pi on pi.product_id = p.id and pi.company_id = p.company_id
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

grant execute on function public.obtener_catalogo_publico(uuid) to anon, authenticated, service_role;

-- Recargar caché de esquema de PostgREST inmediatamente
notify pgrst, 'reload schema';

commit;
