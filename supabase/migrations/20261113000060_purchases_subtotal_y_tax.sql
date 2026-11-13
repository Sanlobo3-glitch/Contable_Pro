-- Fase 1 del IVA de compras: columnas para base e IVA descontable (aditiva, sin cambiar flujos).
alter table public.purchases add column if not exists subtotal numeric;
alter table public.purchases add column if not exists tax numeric not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.purchases'::regclass and conname = 'purchases_tax_non_negative') then
    alter table public.purchases add constraint purchases_tax_non_negative check (tax >= 0);
  end if;
end $$;
comment on column public.purchases.subtotal is 'Base de la compra sin IVA. NULL en compras anteriores a la 060.';
comment on column public.purchases.tax is 'IVA descontable de la compra (valor, no porcentaje). 0 si no se registró.';

select public.sql_registrar_migracion(
  '20261113000060_purchases_subtotal_y_tax',
  'Agregar subtotal y tax (IVA descontable) a purchases',
  '20261113000060_purchases_subtotal_y_tax.sql'
);
