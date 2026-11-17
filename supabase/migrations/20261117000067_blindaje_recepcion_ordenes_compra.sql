-- supabase/migrations/20261117000067_blindaje_recepcion_ordenes_compra.sql
-- Corrección integral de recepción de órdenes de compra (continuación Etapa 1 sobre commit 150f9aa)
-- Idempotente, sin BEGIN/COMMIT. No modifica migraciones históricas ya publicadas.
--   1. public.recibir_orden_compra(...):
--      - Obliga al rol 'almacen' a recibir contra una bodega destino específica y activa (42501 si v_wh IS NULL).
--      - Mantiene la modalidad de inventario general (v_wh IS NULL) exclusivamente para roles corporativos/compras
--        autorizados ('admin', 'dueno', 'admin_empresa', 'comprador') cuando la OC no fija bodega.
--      - Corrige compatibilidad de sucursal: si purchase_orders.branch_id IS NOT NULL, exige
--        warehouses.branch_id IS NOT DISTINCT FROM v_po.branch_id (rechaza también warehouses.branch_id IS NULL).
--      - Conserva aislamiento entre empresas (42501), rechazo de bodega inactiva (P0001),
--        bloqueo de cambio de bodega asignada/pago/días de crédito/costo unitario para 'almacen' (42501),
--        validación finita de cantidades/costos y rechazo de OC en estado draft/cancelled/received.
--   2. public.crear_orden_compra(...):
--      - Valida coherencia entre p_branch_id y p_target_warehouse_id desde la emisión de la orden.

create or replace function public.crear_orden_compra(
  p_supplier_id uuid,
  p_items jsonb,
  p_branch_id uuid default null::uuid,
  p_target_warehouse_id uuid default null::uuid,
  p_payment_terms text default 'credito'::text,
  p_credit_days integer default 30,
  p_expected_date date default null::date,
  p_notes text default null::text,
  p_auto_approve boolean default false
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador']);
  v_target_wh record;
  v_po_id uuid;
  v_seq integer;
  v_po_number text;
  v_sup_name text := 'Proveedor general';
  v_actor_name text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_prod record;
  v_qty numeric;
  v_cost numeric;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la orden de compra';
  end if;

  if p_supplier_id is not null then
    select name into v_sup_name from public.suppliers where id = p_supplier_id and company_id = v_co;
    if not found then
      raise exception 'Proveedor no válido para esta empresa';
    end if;
  end if;

  if p_branch_id is not null and not exists (
    select 1 from public.branches where id = p_branch_id and company_id = v_co
  ) then
    raise exception 'Sucursal no válida para esta empresa';
  end if;

  if p_target_warehouse_id is not null then
    select w.id, w.company_id, w.branch_id, w.active
      into v_target_wh
      from public.warehouses w
     where w.id = p_target_warehouse_id;

    if not found or v_target_wh.company_id is distinct from v_co or not coalesce(v_target_wh.active, false) then
      raise exception 'Bodega destino inválida, inactiva o de otra empresa';
    end if;

    if p_branch_id is not null and v_target_wh.branch_id is distinct from p_branch_id then
      raise exception 'La bodega destino no pertenece a la sucursal de la orden de compra';
    end if;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email, 'Usuario') into v_actor_name
  from public.profiles where id = auth.uid();

  select count(*) + 1 into v_seq from public.purchase_orders where company_id = v_co;
  v_po_number := 'OC-' || lpad(v_seq::text, 4, '0');

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := coalesce((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);
    if not public._es_finito(v_qty) or not public._es_finito(v_cost) or v_qty <= 0 or v_cost < 0 then
      raise exception 'Cantidad y costo deben ser válidos en cada renglón';
    end if;
    v_total := v_total + round(v_qty * v_cost, 2);
  end loop;

  insert into public.purchase_orders (
    company_id, po_number, supplier_id, supplier_name, branch_id, target_warehouse_id,
    status, payment_terms, credit_days, expected_date, subtotal, total, notes,
    created_by, created_by_name,
    approved_by_name, approved_at
  ) values (
    v_co, v_po_number, p_supplier_id, v_sup_name, p_branch_id, p_target_warehouse_id,
    case when p_auto_approve then 'approved' else 'draft' end,
    coalesce(p_payment_terms, 'credito'),
    coalesce(p_credit_days, 30),
    p_expected_date, v_total, v_total,
    nullif(btrim(coalesce(p_notes, '')), ''),
    auth.uid(), v_actor_name,
    case when p_auto_approve then v_actor_name else null end,
    case when p_auto_approve then now() else null end
  )
  returning id into v_po_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select id, name, sku into v_prod
    from public.products
    where id = (v_item->>'product_id')::uuid and company_id = v_co;
    if not found then
      raise exception 'Producto no encontrado en el catálogo de la empresa';
    end if;

    v_qty := coalesce((v_item->>'ordered_qty')::numeric, (v_item->>'quantity')::numeric, 0);
    v_cost := coalesce((v_item->>'unit_cost')::numeric, (v_item->>'cost')::numeric, 0);

    insert into public.purchase_order_items (
      company_id, po_id, product_id, product_name, sku, ordered_qty, unit_cost
    ) values (
      v_co, v_po_id, v_prod.id, v_prod.name, v_prod.sku, v_qty, v_cost
    );
  end loop;

  return v_po_id;
end;
$function$;

create or replace function public.recibir_orden_compra(
  p_po_id uuid,
  p_warehouse_id uuid default null::uuid,
  p_lines jsonb default '[]'::jsonb,
  p_payment_method text default null::text,
  p_credit_days integer default null::integer
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $function$
declare
  v_co uuid := public._require_company_roles(array['admin', 'dueno', 'admin_empresa', 'comprador', 'almacen']);
  v_actor_role text;
  v_po record;
  v_req_wh record;
  v_wh_rec record;
  v_line jsonb;
  v_item record;
  v_item_id uuid;
  v_seen_ids uuid[] := '{}'::uuid[];
  v_rec_now numeric;
  v_rej_now numeric;
  v_req_cost numeric;
  v_unit_cost numeric;
  v_purchase_items jsonb := '[]'::jsonb;
  v_purchase_id uuid;
  v_all_fulfilled boolean := true;
  v_wh uuid;
  v_before numeric;
  v_after numeric;
  v_method text;
  v_days integer;
begin
  select pr.role into v_actor_role
  from public.profiles pr
  where pr.id = auth.uid() and pr.active = true and pr.company_id = v_co;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Debes enviar las líneas a recibir de la orden de compra';
  end if;

  select * into v_po from public.purchase_orders where id = p_po_id and company_id = v_co for update;
  if not found then
    raise exception 'Orden de compra no encontrada';
  end if;
  if v_po.status not in ('approved', 'sent', 'partial') then
    raise exception 'Solo se pueden recibir órdenes de compra aprobadas, enviadas o parciales (estado actual: %)', v_po.status;
  end if;

  if v_po.branch_id is not null and not exists (
    select 1 from public.branches b where b.id = v_po.branch_id and b.company_id = v_co
  ) then
    raise exception 'La sucursal asociada a la orden de compra no pertenece a tu empresa' using errcode = '42501';
  end if;

  if p_warehouse_id is not null then
    select w.id, w.company_id, w.branch_id, w.active
      into v_req_wh
      from public.warehouses w
     where w.id = p_warehouse_id;

    if not found then
      raise exception 'La bodega destino no existe';
    end if;
    if v_req_wh.company_id is distinct from v_co then
      raise exception 'No autorizado: la bodega destino pertenece a otra empresa' using errcode = '42501';
    end if;
    if not coalesce(v_req_wh.active, false) then
      raise exception 'La bodega destino está inactiva';
    end if;
    if v_po.branch_id is not null and v_req_wh.branch_id is distinct from v_po.branch_id then
      raise exception 'La bodega destino no pertenece a la sucursal de la orden de compra';
    end if;
    if v_actor_role = 'almacen'
       and v_po.target_warehouse_id is not null
       and p_warehouse_id is distinct from v_po.target_warehouse_id then
      raise exception 'El rol almacén no puede cambiar la bodega destino asignada en la orden de compra'
        using errcode = '42501';
    end if;
  end if;

  v_wh := coalesce(p_warehouse_id, v_po.target_warehouse_id);

  if v_actor_role = 'almacen' and v_wh is null then
    raise exception 'El rol almacén debe recibir la orden de compra en una bodega destino específica y activa'
      using errcode = '42501';
  end if;

  if v_wh is not null then
    select w.id, w.company_id, w.branch_id, w.active
      into v_wh_rec
      from public.warehouses w
     where w.id = v_wh;

    if not found then
      raise exception 'La bodega destino no existe';
    end if;
    if v_wh_rec.company_id is distinct from v_co then
      raise exception 'No autorizado: la bodega destino pertenece a otra empresa' using errcode = '42501';
    end if;
    if not coalesce(v_wh_rec.active, false) then
      raise exception 'La bodega destino está inactiva';
    end if;
    if v_po.branch_id is not null and v_wh_rec.branch_id is distinct from v_po.branch_id then
      raise exception 'La bodega destino no pertenece a la sucursal de la orden de compra';
    end if;
  end if;

  if v_actor_role = 'almacen' then
    if nullif(btrim(coalesce(p_payment_method, '')), '') is not null
       and btrim(p_payment_method) is distinct from coalesce(v_po.payment_terms, 'credito') then
      raise exception 'El rol almacén no puede modificar la condición de pago de la orden de compra' using errcode = '42501';
    end if;
    if p_credit_days is not null
       and p_credit_days is distinct from coalesce(v_po.credit_days, 30) then
      raise exception 'El rol almacén no puede modificar los días de crédito de la orden de compra' using errcode = '42501';
    end if;
    v_method := coalesce(v_po.payment_terms, 'credito');
    v_days := coalesce(v_po.credit_days, 30);
  else
    v_method := coalesce(nullif(btrim(coalesce(p_payment_method, '')), ''), v_po.payment_terms, 'credito');
    v_days := coalesce(p_credit_days, v_po.credit_days, 30);
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    begin
      v_item_id := (v_line->>'item_id')::uuid;
    exception when others then
      raise exception 'Identificador de renglón inválido en recepción de OC';
    end;

    if v_item_id is null then
      raise exception 'Falta item_id en línea de recepción de OC';
    end if;
    if v_item_id = any(v_seen_ids) then
      raise exception 'Línea duplicada (%) en recepción de orden de compra', v_item_id;
    end if;
    v_seen_ids := array_append(v_seen_ids, v_item_id);

    select * into v_item
      from public.purchase_order_items
     where id = v_item_id and po_id = p_po_id and company_id = v_co
     for update;

    if not found then
      raise exception 'El renglón % no pertenece a esta orden de compra', v_item_id;
    end if;

    v_rec_now := coalesce((v_line->>'received_now')::numeric, 0);
    v_rej_now := coalesce((v_line->>'rejected_now')::numeric, 0);
    if not public._es_finito(v_rec_now) or not public._es_finito(v_rej_now) or v_rec_now < 0 or v_rej_now < 0 then
      raise exception 'Las cantidades recibidas y rechazadas no pueden ser negativas ni inválidas';
    end if;

    if (coalesce(v_item.received_qty, 0) + coalesce(v_item.rejected_qty, 0) + v_rec_now + v_rej_now)
       > coalesce(v_item.ordered_qty, 0) + 0.0001 then
      raise exception 'La cantidad recibida/rechazada de "%" supera lo ordenado (%)', v_item.product_name, v_item.ordered_qty;
    end if;

    if (v_line ? 'unit_cost') and nullif(btrim(coalesce(v_line->>'unit_cost', '')), '') is not null then
      v_req_cost := (v_line->>'unit_cost')::numeric;
      if not public._es_finito(v_req_cost) or v_req_cost < 0 then
        raise exception 'El costo unitario no puede ser negativo ni inválido';
      end if;
      if v_actor_role = 'almacen' and abs(v_req_cost - coalesce(v_item.unit_cost, 0)) > 0.0001 then
        raise exception 'El rol almacén no puede modificar el costo unitario pactado en la orden de compra' using errcode = '42501';
      end if;
      v_unit_cost := v_req_cost;
    else
      v_unit_cost := coalesce(v_item.unit_cost, 0);
    end if;

    if v_rec_now > 0 then
      v_purchase_items := v_purchase_items || jsonb_build_array(
        jsonb_strip_nulls(jsonb_build_object(
          'product_id', v_item.product_id,
          'product_name', v_item.product_name,
          'quantity', v_rec_now,
          'cost', v_unit_cost,
          'subtotal', round(v_rec_now * v_unit_cost, 2),
          'lot_code', nullif(btrim(coalesce(v_line->>'lot_code', '')), ''),
          'expiry_date', nullif(btrim(coalesce(v_line->>'expiry_date', '')), '')
        ))
      );
    end if;

    update public.purchase_order_items
       set received_qty = received_qty + v_rec_now,
           rejected_qty = rejected_qty + v_rej_now,
           unit_cost = v_unit_cost,
           lot_code = coalesce(nullif(btrim(coalesce(v_line->>'lot_code', '')), ''), lot_code),
           expiry_date = coalesce(nullif(btrim(coalesce(v_line->>'expiry_date', '')), '')::date, expiry_date)
     where id = v_item.id and company_id = v_co;
  end loop;

  if jsonb_array_length(v_purchase_items) = 0 then
    raise exception 'Indica al menos una unidad recibida conforme para ingresar al inventario';
  end if;

  v_purchase_id := public._registrar_compra_core(
    v_co,
    v_po.supplier_id,
    v_purchase_items,
    v_method,
    case when v_method = 'credito' then v_days else null end,
    0,
    'sin_iva',
    null,
    false
  );

  update public.purchases
     set branch_id = v_po.branch_id,
         warehouse_id = v_wh
   where id = v_purchase_id and company_id = v_co;

  if v_wh is not null then
    for v_line in select * from jsonb_array_elements(v_purchase_items) loop
      v_rec_now := (v_line->>'quantity')::numeric;
      insert into public.warehouse_stock (company_id, warehouse_id, product_id, quantity, reserved_quantity)
      values (v_co, v_wh, (v_line->>'product_id')::uuid, 0, 0)
      on conflict (warehouse_id, product_id) do nothing;

      select quantity into v_before
        from public.warehouse_stock
       where company_id = v_co and warehouse_id = v_wh and product_id = (v_line->>'product_id')::uuid
       for update;

      v_after := coalesce(v_before, 0) + v_rec_now;

      update public.warehouse_stock
         set quantity = v_after, updated_at = now()
       where company_id = v_co and warehouse_id = v_wh and product_id = (v_line->>'product_id')::uuid;

      insert into public.warehouse_movements (
        company_id, warehouse_id, product_id, movement_type,
        quantity_delta, quantity_before, quantity_after,
        reference_type, reference_id, notes, created_by
      ) values (
        v_co, v_wh, (v_line->>'product_id')::uuid, 'entry',
        v_rec_now, coalesce(v_before, 0), v_after,
        'purchase_order', v_po.id, 'Recepción ' || v_po.po_number, auth.uid()
      );
    end loop;
  end if;

  select bool_and((received_qty + rejected_qty) >= ordered_qty)
    into v_all_fulfilled
    from public.purchase_order_items
   where po_id = p_po_id and company_id = v_co;

  update public.purchase_orders
     set status = case when coalesce(v_all_fulfilled, true) then 'received' else 'partial' end,
         target_warehouse_id = coalesce(v_po.target_warehouse_id, v_wh),
         linked_purchase_id = v_purchase_id,
         received_at = now(),
         updated_at = now()
   where id = p_po_id and company_id = v_co;

  return v_purchase_id;
end;
$function$;

revoke all on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) from public, anon;
grant execute on function public.crear_orden_compra(uuid, jsonb, uuid, uuid, text, integer, date, text, boolean) to authenticated, service_role;

revoke all on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) from public, anon;
grant execute on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) to authenticated, service_role;

select public.sql_registrar_migracion(
  '20261117000067_blindaje_recepcion_ordenes_compra',
  'Etapa 1 Auditoría OC: bodega obligatoria para almacén, compatibilidad estricta de sucursal y coherencia en crear/recibir OC',
  '20261117000067_blindaje_recepcion_ordenes_compra.sql'
);
