-- supabase/migrations/20261116000066_blindaje_etapa1_auditoria_77cd7d5.sql
-- Corrección de hallazgos 2 y 3 de la auditoría independiente de Etapa 1 (commit 77cd7d5)
-- Idempotente, sin BEGIN/COMMIT. No modifica migraciones históricas ya publicadas.
--   - Hallazgo 2: Restringe public.acc_post_entry(uuid) para que el rol 'contador' solo pueda
--                 contabilizar borradores propios (created_by = auth.uid()) con source_type IN ('manual', 'ajuste').
--   - Hallazgo 3: Endurece public.recibir_orden_compra(...) validando bodega destino (empresa, activa,
--                 sucursal) e impidiendo que el rol 'almacen' cambie la bodega asignada en la orden de compra.

-- =============================================================================
-- 1. HALLAZGO 2: ENDURECER acc_post_entry PARA SEPARACIÓN DE FUNCIONES DE CONTADOR
-- =============================================================================

create or replace function public.acc_post_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_c uuid := public.current_company_id();
  v_role text;
  v_entry public.acc_entries%rowtype;
begin
  if auth.uid() is null or v_c is null then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select pr.role
    into v_role
    from public.profiles pr
   where pr.id = auth.uid()
     and pr.active = true
     and pr.company_id = v_c
     and pr.role in ('admin', 'dueno', 'admin_empresa', 'gerente', 'contador');

  if not found then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select *
    into v_entry
    from public.acc_entries
   where id = p_entry_id
     and company_id = v_c
   for update;

  if not found or v_entry.status <> 'borrador' then
    raise exception 'El asiento no existe o ya no es un borrador';
  end if;

  if v_role = 'contador' then
    if coalesce(v_entry.source_type, '') not in ('manual', 'ajuste')
       or v_entry.created_by is distinct from auth.uid() then
      raise exception 'No autorizado: el contador solo puede contabilizar sus propios asientos manuales o de ajuste'
        using errcode = '42501';
    end if;
  end if;

  if not public.acc_period_is_open(v_c, v_entry.entry_date) then
    raise exception 'El periodo de esa fecha está cerrado';
  end if;

  update public.acc_entries
     set status = 'contabilizado',
         posted_by = auth.uid()
   where id = v_entry.id
     and company_id = v_c
     and status = 'borrador';

  if not found then
    raise exception 'El asiento no existe o ya no es un borrador';
  end if;
end;
$function$;

revoke all on function public.acc_post_entry(uuid) from public, anon;
grant execute on function public.acc_post_entry(uuid) to authenticated, service_role;

-- =============================================================================
-- 2. HALLAZGO 3: VALIDACIÓN ESTRICTA DE BODEGA EN recibir_orden_compra
-- =============================================================================

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
    if v_po.branch_id is not null and v_req_wh.branch_id is not null and v_req_wh.branch_id is distinct from v_po.branch_id then
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
    if v_po.branch_id is not null and v_wh_rec.branch_id is not null and v_wh_rec.branch_id is distinct from v_po.branch_id then
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
    if v_rec_now < 0 or v_rej_now < 0 then
      raise exception 'Las cantidades recibidas y rechazadas no pueden ser negativas';
    end if;

    if (coalesce(v_item.received_qty, 0) + coalesce(v_item.rejected_qty, 0) + v_rec_now + v_rej_now)
       > coalesce(v_item.ordered_qty, 0) + 0.0001 then
      raise exception 'La cantidad recibida/rechazada de "%" supera lo ordenado (%)', v_item.product_name, v_item.ordered_qty;
    end if;

    if (v_line ? 'unit_cost') and nullif(btrim(coalesce(v_line->>'unit_cost', '')), '') is not null then
      v_req_cost := (v_line->>'unit_cost')::numeric;
      if v_req_cost < 0 then
        raise exception 'El costo unitario no puede ser negativo';
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

revoke all on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) from public, anon;
grant execute on function public.recibir_orden_compra(uuid, uuid, jsonb, text, integer) to authenticated, service_role;

-- =============================================================================
-- 3. REGISTRO OBLIGATORIO EN BITÁCORA DE MIGRACIONES
-- =============================================================================

select public.sql_registrar_migracion(
  '20261116000066_blindaje_etapa1_auditoria_77cd7d5',
  'Etapa 1 Auditoría: blindaje acc_post_entry (contador) y recibir_orden_compra (bodega)',
  '20261116000066_blindaje_etapa1_auditoria_77cd7d5.sql'
);
