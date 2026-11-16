-- supabase/tests/etapa1_permisos_y_seguridad_rollback_tests.sql
-- Suite transaccional no destructiva (BEGIN ... ROLLBACK) para verificar la Etapa 1
-- y los hallazgos de auditoría (commit 77cd7d5 + migración 000066):
--   1. Separación de funciones por rol (1A Contador incl. acc_post_entry limitado a borradores propios manual/ajuste,
--      2A Comprador/Almacén incl. bloqueo estricto de bodega asignada y estado de OC, 3B Gerente/admin_empresa, 4A Vendedor)
--   2. Aislamiento multiempresa estricto (incluyendo cuentas admin globales sin bypass en DIAN/F300/F350/acc_post_entry)
--   3. Bloqueo de perfiles inactivos (active = false)
--   4. Endurecimiento de privilegios de tablas y funciones internas
--   5. Sin falsos positivos: ninguna prueba usa WHEN OTHERS THEN NULL; toda operación prohibida verifica
--      éxito inesperado FUERA del bloque EXCEPTION y exige el SQLSTATE/mensaje exacto esperado.
--
-- USO: Ejecutar en SQL Editor o psql contra una instancia donde ya se hayan aplicado
--      las migraciones 20261115000065 y 20261116000066.
--      Al terminar con ROLLBACK, no deja datos ni alteraciones persistentes.

BEGIN;

DO $$
DECLARE
  -- Empresas de prueba
  v_co_a uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  v_co_b uuid := 'bbbbbbbb-0000-4000-8000-000000000002';

  -- Usuarios de prueba (Empresa A por cada rol + inactivo + Empresa B)
  v_u_admin_a   uuid := '11111111-0000-4000-8000-000000000001';
  v_u_dueno_a   uuid := '11111111-0000-4000-8000-000000000002';
  v_u_adm_emp_a uuid := '11111111-0000-4000-8000-000000000003';
  v_u_gerente_a uuid := '11111111-0000-4000-8000-000000000004';
  v_u_conta_a   uuid := '11111111-0000-4000-8000-000000000005';
  v_u_compra_a  uuid := '11111111-0000-4000-8000-000000000006';
  v_u_almacen_a uuid := '11111111-0000-4000-8000-000000000007';
  v_u_vend_a    uuid := '11111111-0000-4000-8000-000000000008';
  v_u_inact_a   uuid := '11111111-0000-4000-8000-000000000009';
  v_u_dueno_b   uuid := '22222222-0000-4000-8000-000000000001';

  -- Datos base en Empresa A (dos bodegas activas) y Empresa B
  v_wh_a        uuid := 'aaaaaaaa-1111-4000-8000-000000000001';
  v_wh_a2       uuid := 'aaaaaaaa-1111-4000-8000-000000000099';
  v_wh_b        uuid := 'bbbbbbbb-1111-4000-8000-000000000002';
  v_sup_a       uuid := 'aaaaaaaa-2222-4000-8000-000000000001';
  v_sup_b       uuid := 'bbbbbbbb-2222-4000-8000-000000000002';
  v_prod_a      uuid := 'aaaaaaaa-3333-4000-8000-000000000001';
  v_prod_b      uuid := 'bbbbbbbb-3333-4000-8000-000000000002';

  -- Cuentas contables de Empresa A y Empresa B
  v_acc_inv_a   uuid;
  v_acc_iva_d_a uuid;
  v_acc_iva_p_a uuid;
  v_acc_cxp_a   uuid;
  v_acc_caja_a  uuid;
  v_acc_caja_b  uuid;
  v_acc_inv_b   uuid;

  -- Objetos creados durante las pruebas
  v_pur_pend_a        uuid;
  v_pur_adm_a         uuid;
  v_pur_comp_a        uuid;
  v_po_draft_a        uuid;
  v_po_draft_item_a   uuid;
  v_po_app_a          uuid;
  v_po_item_a         uuid;
  v_dev_a             uuid;
  v_entry_a           uuid;
  v_entry_conta_draft uuid;
  v_entry_op_draft    uuid;
  v_entry_dueno_draft uuid;
  v_entry_b_draft     uuid;
  v_cnt               int;
  v_status            text;
  v_stock_wh_a        numeric;
  v_stock_wh_a2       numeric;
  v_json              jsonb;

  -- Variables de control estricto de excepciones (fuera de los bloques BEGIN...EXCEPTION)
  v_unexpected_ok boolean;
  v_err_state     text;
  v_err_msg       text;
BEGIN
  -- ---------------------------------------------------------------------------
  -- 0. PREPARAR EMPRESAS, USUARIOS AUTH Y PERFILES DE PRUEBA
  -- ---------------------------------------------------------------------------
  INSERT INTO public.companies (id, name, active)
  VALUES
    (v_co_a, 'Empresa Prueba A', true),
    (v_co_b, 'Empresa Prueba B', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  VALUES
    (v_u_admin_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_admin_a@contable.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_dueno_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_dueno_a@contable.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_adm_emp_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_admemp_a@contable.local',  '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_gerente_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_gerente_a@contable.local', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_conta_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_conta_a@contable.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_compra_a,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_compra_a@contable.local',  '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_almacen_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_almacen_a@contable.local', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_vend_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_vend_a@contable.local',    '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_inact_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_inact_a@contable.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_dueno_b,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test_dueno_b@contable.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name, role, company_id, active)
  VALUES
    (v_u_admin_a,   'test_admin_a@contable.local',   'Admin Global A',   'admin',         v_co_a, true),
    (v_u_dueno_a,   'test_dueno_a@contable.local',   'Dueño A',          'dueno',         v_co_a, true),
    (v_u_adm_emp_a, 'test_admemp_a@contable.local',  'Admin Empresa A',  'admin_empresa', v_co_a, true),
    (v_u_gerente_a, 'test_gerente_a@contable.local', 'Gerente A',        'gerente',       v_co_a, true),
    (v_u_conta_a,   'test_conta_a@contable.local',   'Contador A',       'contador',      v_co_a, true),
    (v_u_compra_a,  'test_compra_a@contable.local',  'Comprador A',      'comprador',     v_co_a, true),
    (v_u_almacen_a, 'test_almacen_a@contable.local', 'Almacén A',        'almacen',       v_co_a, true),
    (v_u_vend_a,    'test_vend_a@contable.local',    'Vendedor A',       'vendedor',      v_co_a, true),
    (v_u_inact_a,   'test_inact_a@contable.local',   'Inactivo A',       'dueno',         v_co_a, false),
    (v_u_dueno_b,   'test_dueno_b@contable.local',   'Dueño B',          'dueno',         v_co_b, true)
  ON CONFLICT (id) DO UPDATE SET
    role = EXCLUDED.role,
    company_id = EXCLUDED.company_id,
    active = EXCLUDED.active;

  INSERT INTO public.warehouses (id, company_id, name, active)
  VALUES
    (v_wh_a,  v_co_a, 'Bodega Principal A', true),
    (v_wh_a2, v_co_a, 'Bodega Secundaria A', true),
    (v_wh_b,  v_co_b, 'Bodega Principal B', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.suppliers (id, company_id, name, document)
  VALUES
    (v_sup_a, v_co_a, 'Proveedor Test A', '900111222-1'),
    (v_sup_b, v_co_b, 'Proveedor Test B', '900333444-2')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.products (id, company_id, name, sku, stock, cost, price, tracks_expiry)
  VALUES
    (v_prod_a, v_co_a, 'Producto Prueba A', 'SKU-TEST-A', 10, 1000, 2000, false),
    (v_prod_b, v_co_b, 'Producto Prueba B', 'SKU-TEST-B', 10, 1000, 2000, false)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.dian_tax_rules (company_id, tax_type, concept_name, percentage, account_code, active)
  VALUES
    (v_co_a, 'retefuente', 'Regla Empresa A', 2.5, '236540', true),
    (v_co_b, 'retefuente', 'Regla Secreta B', 2.5, '236540', true);

  INSERT INTO public.dian_account_mappings (company_id, account_prefix, dian_form, dian_concept, column_target)
  VALUES
    (v_co_a, '5105', '1001', '5001', 'pago_deducible'),
    (v_co_b, '5105', '1001', '5001', 'pago_deducible');

  INSERT INTO public.dian_certificates_issued (company_id, fiscal_year, cert_type, third_party_id, third_party_name, total_base, total_retained)
  VALUES
    (v_co_a, 2026, 'retefuente', '900111222', 'Tercero A', 100000, 2500),
    (v_co_b, 2026, 'retefuente', '900333444', 'Tercero B', 200000, 5000);

  -- Activar contabilidad básica para Empresa A (como Dueño A)
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.acc_seed_template('generico');

  RESET ROLE;

  SELECT id INTO v_acc_inv_a   FROM public.acc_accounts WHERE company_id = v_co_a AND code = '1.1.04';
  SELECT id INTO v_acc_iva_d_a FROM public.acc_accounts WHERE company_id = v_co_a AND code = '1.1.05';
  SELECT id INTO v_acc_iva_p_a FROM public.acc_accounts WHERE company_id = v_co_a AND code = '1.1.06';
  SELECT id INTO v_acc_cxp_a   FROM public.acc_accounts WHERE company_id = v_co_a AND code = '2.1.01';
  SELECT id INTO v_acc_caja_a  FROM public.acc_accounts WHERE company_id = v_co_a AND code = '1.1.01';

  UPDATE public.acc_settings
     SET active = true,
         start_date = (current_date - 30),
         timezone = 'America/Bogota'
   WHERE company_id = v_co_a;

  SET LOCAL ROLE authenticated;
  PERFORM public.acc_save_settings(jsonb_build_object(
    'caja', v_acc_caja_a::text,
    'inventario', v_acc_inv_a::text,
    'iva_descontable', v_acc_iva_d_a::text,
    'iva_pendiente', v_acc_iva_p_a::text
  ));
  PERFORM public.cxp_save_account(v_acc_cxp_a);

  -- Borrador manual creado por Dueño A (el Contador NO debe poder contabilizarlo)
  v_entry_dueno_draft := public.acc_create_entry(
    current_date,
    'Asiento manual borrador de Dueño A',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_caja_a, 'debit', 500, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inv_a,  'debit', 0,   'credit', 500)
    ),
    false,
    'manual',
    NULL,
    'registro'
  );
  RESET ROLE;

  -- Borrador operativo ('compra') en Empresa A (el Contador NO debe poder contabilizarlo vía acc_post_entry)
  INSERT INTO public.acc_entries (
    company_id, number, entry_date, description, source_type, source_id, source_event, status, created_by
  ) VALUES (
    v_co_a, 'CMP-TEST-0001', current_date, 'Borrador operativo compra', 'compra', gen_random_uuid(), 'registro', 'borrador', v_u_conta_a
  ) RETURNING id INTO v_entry_op_draft;

  INSERT INTO public.acc_lines (entry_id, company_id, account_id, debit, credit, memo)
  VALUES
    (v_entry_op_draft, v_co_a, v_acc_inv_a,  1000, 0,    'Inventario'),
    (v_entry_op_draft, v_co_a, v_acc_caja_a, 0,    1000, 'Caja');

  -- Activar contabilidad básica en Empresa B y crear borrador en B para probar aislamiento de acc_post_entry
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_b::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.acc_seed_template('generico');
  RESET ROLE;

  SELECT id INTO v_acc_caja_b FROM public.acc_accounts WHERE company_id = v_co_b AND code = '1.1.01';
  SELECT id INTO v_acc_inv_b  FROM public.acc_accounts WHERE company_id = v_co_b AND code = '1.1.04';

  UPDATE public.acc_settings
     SET active = true,
         start_date = (current_date - 30),
         timezone = 'America/Bogota'
   WHERE company_id = v_co_b;

  SET LOCAL ROLE authenticated;
  v_entry_b_draft := public.acc_create_entry(
    current_date,
    'Borrador manual Empresa B',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_caja_b, 'debit', 300, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inv_b,  'debit', 0,   'credit', 300)
    ),
    false,
    'manual',
    NULL,
    'registro'
  );
  RESET ROLE;

  -- ===========================================================================
  -- PRUEBA 1 (Decisión 1A + Hallazgo 2): CONTADOR con separación de funciones
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1.1 Permitido: can_view_accounting / acc_reconcile / acc_create_entry (manual/ajuste propios) / acc_post_entry propio / F300 & F350
  ASSERT public.can_view_accounting(), 'FALLO 1A: contador debe ver contabilidad';
  PERFORM * FROM public.acc_reconcile();

  v_entry_a := public.acc_create_entry(
    current_date,
    'Asiento manual prueba contador (posteado directo)',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_caja_a, 'debit', 1000, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inv_a,  'debit', 0,    'credit', 1000)
    ),
    true,
    'manual',
    NULL,
    'registro'
  );
  ASSERT v_entry_a IS NOT NULL, 'FALLO 1A: contador debe poder crear y contabilizar asiento manual';

  v_entry_conta_draft := public.acc_create_entry(
    current_date,
    'Asiento ajuste borrador propio contador',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_caja_a, 'debit', 250, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inv_a,  'debit', 0,   'credit', 250)
    ),
    false,
    'ajuste',
    NULL,
    'registro'
  );
  PERFORM public.acc_post_entry(v_entry_conta_draft);

  v_json := public.dian_calcular_formulario_300(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
  ASSERT v_json IS NOT NULL, 'FALLO 1A: contador debe poder calcular F300 de su empresa';
  v_json := public.dian_calcular_formulario_350(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
  ASSERT v_json IS NOT NULL, 'FALLO 1A: contador debe poder calcular F350 de su empresa';

  -- 1.2 Hallazgo 2: Contador NO puede contabilizar borrador operativo ('compra') aunque created_by sea auth.uid()
  v_unexpected_ok := false;
  v_err_state := NULL;
  v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_entry(v_entry_op_draft);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO HALLAZGO 2: contador NO debe contabilizar borrador operativo (source_type=compra)';
  END IF;
  IF v_err_state <> '42501' THEN
    RAISE EXCEPTION 'FALLO HALLAZGO 2: se esperaba SQLSTATE 42501 en acc_post_entry operativo y ocurrió [%] %', v_err_state, v_err_msg;
  END IF;

  -- 1.3 Hallazgo 2: Contador NO puede contabilizar borrador manual creado por otro usuario (Dueño A)
  v_unexpected_ok := false;
  v_err_state := NULL;
  v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_entry(v_entry_dueno_draft);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO HALLAZGO 2: contador NO debe contabilizar borrador manual de otro usuario';
  END IF;
  IF v_err_state <> '42501' THEN
    RAISE EXCEPTION 'FALLO HALLAZGO 2: se esperaba SQLSTATE 42501 en acc_post_entry ajeno y ocurrió [%] %', v_err_state, v_err_msg;
  END IF;

  -- 1.4 Denegado (42501): acc_save_settings, acc_seed_template, acc_post_pending, registrar_compra_con_iva, cuentas_por_pagar
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_save_settings(jsonb_build_object('caja', v_acc_caja_a::text));
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_save_settings'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 1A (acc_save_settings): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_seed_template('generico');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_seed_template'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 1A (acc_seed_template): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_pending();
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_post_pending'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 1A (acc_post_pending): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_compra_con_iva(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL, 0, 'sin_iva', 0, false);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 1A: contador NO debería registrar compras'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 1A (registrar_compra_con_iva): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cuentas_por_pagar();
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 1A: contador NO debería operar CxP'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 1A (cuentas_por_pagar): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  SELECT status INTO v_status FROM public.acc_entries WHERE id = v_entry_conta_draft;
  ASSERT v_status = 'contabilizado', 'FALLO 1A: borrador propio del contador debe quedar contabilizado';
  SELECT status INTO v_status FROM public.acc_entries WHERE id = v_entry_op_draft;
  ASSERT v_status = 'borrador', 'FALLO HALLAZGO 2: borrador operativo debe seguir en borrador';
  SELECT status INTO v_status FROM public.acc_entries WHERE id = v_entry_dueno_draft;
  ASSERT v_status = 'borrador', 'FALLO HALLAZGO 2: borrador de otro usuario debe seguir en borrador';

  -- ===========================================================================
  -- PRUEBA 2 (Decisión 2A + Hallazgos 1 y 3): COMPRADOR vs ALMACÉN
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pur_pend_a := public.registrar_compra_con_iva(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 2, 'cost', 1000)),
    'credito', 30, 380, 'pendiente', 19, false
  );
  ASSERT v_pur_pend_a IS NOT NULL, 'FALLO 2A: comprador debe registrar compra';

  v_pur_comp_a := public.registrar_compra_con_iva(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)),
    'efectivo', NULL, 0, 'sin_iva', 0, false
  );

  v_po_draft_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 4, 'unit_cost', 1200)),
    NULL, v_wh_a, 'credito', 45, current_date + 5, 'OC borrador test', false
  );

  v_po_app_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 5, 'unit_cost', 1200)),
    NULL, v_wh_a, 'credito', 45, current_date + 5, 'OC aprobada test', true
  );

  -- Comprador NO puede anular compra, ni devolver a proveedor, ni pagar CxP, ni clasificar IVA
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.anular_compra(v_pur_comp_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: comprador NO debería anular compras'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (anular_compra): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_devolucion_compra(v_pur_comp_a, v_prod_a, 1, 'Prueba', 'efectivo');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: comprador NO debería registrar devolución a proveedor'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (registrar_devolucion_compra): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'Prueba', NULL);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: comprador NO debería pagar CxP'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (registrar_pago_proveedor): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.clasificar_iva_compra(v_pur_pend_a, 'descontable', 'Prueba');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: comprador NO debería clasificar IVA'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (clasificar_iva_compra): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  SELECT id INTO v_po_draft_item_a FROM public.purchase_order_items WHERE po_id = v_po_draft_a LIMIT 1;
  SELECT id INTO v_po_item_a       FROM public.purchase_order_items WHERE po_id = v_po_app_a LIMIT 1;

  -- 2.2 Contador sí puede clasificar el IVA pendiente creado por Comprador
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.clasificar_iva_compra(v_pur_pend_a, 'descontable', 'Clasificado por contador');
  RESET ROLE;

  -- 2.3 Almacén: NO compra directa, NO aprueba OC, NO recibe OC en draft, NO cambia bodega ni condiciones en recepción
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_compra(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: almacén NO debería registrar compras directas'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (registrar_compra almacén): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_draft_a, 'approved');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: almacén NO debería aprobar órdenes de compra'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (cambiar_estado_orden_compra almacén): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- Escenario explícito 1 (Hallazgo 1): Almacén intenta recibir OC en estado 'draft'
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_draft_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_draft_item_a, 'received_now', 1)),
      'credito', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 1): almacén NO debería recibir una OC en estado draft';
  END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%aprobadas, enviadas o parciales%' THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 1): error inesperado al recibir OC draft [%] %', v_err_state, v_err_msg;
  END IF;

  -- Escenario explícito 2 (Hallazgos 1 y 3): Almacén intenta recibir OC con bodega de Empresa B -> SQLSTATE 42501
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_b,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
      'credito', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 1/3): almacén NO debe recibir en bodega de Empresa B';
  END IF;
  IF v_err_state <> '42501' THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 1/3 bodega Empresa B): se esperaba SQLSTATE 42501 y ocurrió [%] %', v_err_state, v_err_msg;
  END IF;

  -- Escenario explícito 3 (Hallazgo 3): Almacén intenta cambiar target_warehouse_id asignado (v_wh_a -> v_wh_a2 dentro de Empresa A) -> SQLSTATE 42501
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_a2,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
      'credito', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 3): almacén NO debe cambiar la bodega destino asignada en la OC';
  END IF;
  IF v_err_state <> '42501' THEN
    RAISE EXCEPTION 'FALLO 2A (HALLAZGO 3 cambio bodega): se esperaba SQLSTATE 42501 y ocurrió [%] %', v_err_state, v_err_msg;
  END IF;

  -- Intento de Almacén de cambiar forma de pago pactada -> 42501
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
      'efectivo', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: almacén NO debe alterar p_payment_method de la OC'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (p_payment_method): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- Intento de Almacén de alterar unit_cost pactado -> 42501
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2, 'unit_cost', 9999)),
      'credito', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 2A: almacén NO debe alterar unit_cost pactado en la OC'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 2A (unit_cost): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- Recepción legítima de Almacén en la bodega asignada v_wh_a con parámetros exactos de la OC -> éxito
  ASSERT public.recibir_orden_compra(
    v_po_app_a, v_wh_a,
    jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
    'credito', 45
  ) IS NOT NULL, 'FALLO 2A: almacén debe poder recibir físicamente OC aprobada en su bodega asignada';

  RESET ROLE;

  SELECT status INTO v_status FROM public.purchase_orders WHERE id = v_po_draft_a;
  ASSERT v_status = 'draft', 'FALLO 2A: OC en draft no debió cambiar de estado';

  SELECT coalesce(quantity, 0) INTO v_stock_wh_a
    FROM public.warehouse_stock WHERE company_id = v_co_a AND warehouse_id = v_wh_a AND product_id = v_prod_a;
  SELECT coalesce(quantity, 0) INTO v_stock_wh_a2
    FROM public.warehouse_stock WHERE company_id = v_co_a AND warehouse_id = v_wh_a2 AND product_id = v_prod_a;
  ASSERT coalesce(v_stock_wh_a, 0) = 2, 'FALLO 2A: bodega v_wh_a debió incrementar en 2 unidades';
  ASSERT coalesce(v_stock_wh_a2, 0) = 0, 'FALLO 2A: bodega v_wh_a2 no debió recibir unidades';

  -- ===========================================================================
  -- PRUEBA 3 (Decisión 3B + Hallazgo 1): ADMIN_EMPRESA paridad con DUEÑO; GERENTE solo supervisión
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_adm_emp_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_adm_emp_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pur_adm_a := public.registrar_compra_con_iva(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 3, 'cost', 1000)),
    'credito', 30, 570, 'descontable', 19, false
  );
  v_dev_a := public.registrar_devolucion_compra(v_pur_adm_a, v_prod_a, 1, 'Defecto', 'credito');
  PERFORM public.anular_devolucion_compra(v_dev_a);
  PERFORM public.anular_compra(v_pur_adm_a);
  PERFORM public.guardar_credito_proveedor(v_sup_a, 500000, 30);

  -- Paridad: admin_empresa SÍ puede contabilizar borrador operativo pendiente en su empresa
  PERFORM public.acc_post_entry(v_entry_op_draft);

  -- Hallazgo 1: verificar fuera del EXCEPTION que acc_reopen_period NO rechaza por 42501 sino por negocio ('Ese periodo no está cerrado')
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_reopen_period(2026, 1, 'Prueba paridad admin_empresa');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'FALLO 3B (HALLAZGO 1): el periodo 2026-01 no estaba cerrado y no debió reabrirse';
  END IF;
  IF v_err_state = '42501' THEN
    RAISE EXCEPTION 'FALLO 3B (HALLAZGO 1): admin_empresa no debe fallar por 42501 en acc_reopen_period: %', v_err_msg;
  END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%no está cerrado%' THEN
    RAISE EXCEPTION 'FALLO 3B (HALLAZGO 1): error inesperado en acc_reopen_period [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT status INTO v_status FROM public.acc_entries WHERE id = v_entry_op_draft;
  ASSERT v_status = 'contabilizado', 'FALLO 3B: admin_empresa debe poder contabilizar borrador operativo';

  -- Gerente: consulta CxP, concilia y contabiliza borradores manuales, pero NO registra compras, NO anula compras/devoluciones, NO paga CxP
  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT public.cuentas_por_pagar() IS NOT NULL, 'FALLO 3B: gerente debe consultar CxP';
  ASSERT public.cxp_config() IS NOT NULL, 'FALLO 3B: gerente debe consultar config CxP';
  PERFORM * FROM public.acc_reconcile();
  PERFORM public.acc_post_entry(v_entry_dueno_draft);

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_compra_con_iva(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL, 0, 'sin_iva', 0, false);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar compras directas'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (registrar_compra_con_iva gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.anular_compra(v_pur_comp_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe anular compras'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (anular_compra gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_devolucion_compra(v_pur_comp_a, v_prod_a, 1, 'No permitido', 'efectivo');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar devoluciones a proveedor'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (registrar_devolucion_compra gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'No permitido', NULL);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar pagos CxP'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (registrar_pago_proveedor gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cxp_save_account(v_acc_cxp_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe cambiar cuenta CxP'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (cxp_save_account gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_reopen_period(2026, 1, 'No permitido para gerente');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 3B: gerente NO debe poder reabrir periodos contables'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 3B (acc_reopen_period gerente): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  SELECT status INTO v_status FROM public.acc_entries WHERE id = v_entry_dueno_draft;
  ASSERT v_status = 'contabilizado', 'FALLO 3B: gerente debe poder contabilizar borrador manual de su empresa';

  -- ===========================================================================
  -- PRUEBA 4 (Condiciones 1 y 2): AISLAMIENTO MULTIEMPRESA + ADMIN SIN BYPASS + PERFIL INACTIVO
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_admin_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_admin_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_cnt FROM public.dian_tax_rules WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_tax_rules de Empresa B';

  SELECT count(*) INTO v_cnt FROM public.dian_account_mappings WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_account_mappings de Empresa B';

  SELECT count(*) INTO v_cnt FROM public.dian_certificates_issued WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_certificates_issued de Empresa B';

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    INSERT INTO public.dian_tax_rules (company_id, tax_type, concept_name, percentage, account_code)
    VALUES (v_co_b, 'retefuente', 'Intrusión', 2.5, '236540');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO RLS: admin de Empresa A pudo insertar dian_tax_rules en Empresa B'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO RLS (INSERT dian_tax_rules B): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.dian_calcular_formulario_300(v_co_b, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO AISLAMIENTO: admin de Empresa A pudo consultar F300 de Empresa B'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO AISLAMIENTO (F300 B): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.dian_calcular_formulario_350(v_co_b, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO AISLAMIENTO: admin de Empresa A pudo consultar F350 de Empresa B'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO AISLAMIENTO (F350 B): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- Admin de Empresa A tampoco debe poder contabilizar borrador de Empresa B
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_entry(v_entry_b_draft);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO AISLAMIENTO: admin de Empresa A pudo contabilizar asiento de Empresa B'; END IF;
  IF v_err_state <> 'P0001' THEN RAISE EXCEPTION 'FALLO AISLAMIENTO (acc_post_entry B): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  -- 4.2 Perfil inactivo (even with role='dueno') queda bloqueado en todas las RPCs y RLS
  PERFORM set_config('request.jwt.claim.sub', v_u_inact_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_inact_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT NOT public.can_view_accounting(), 'FALLO INACTIVO: perfil active=false obtuvo can_view_accounting() = true';

  SELECT count(*) INTO v_cnt FROM public.dian_tax_rules WHERE company_id = v_co_a;
  ASSERT v_cnt = 0, 'FALLO INACTIVO: perfil active=false vio dian_tax_rules';

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_compra(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO INACTIVO: perfil active=false pudo registrar compra'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO INACTIVO (registrar_compra): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  -- 4.3 Vendedor bloqueado en contabilidad, compras, DIAN y devoluciones de compra
  PERFORM set_config('request.jwt.claim.sub', v_u_vend_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_vend_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.dian_calcular_formulario_300(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 4A: vendedor no debe ejecutar F300'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO 4A (F300 vendedor): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- 4.4 Endurecimiento de privilegios directos DML y funciones internas
  ASSERT NOT has_table_privilege('authenticated', 'public.purchases', 'INSERT'), 'FALLO GRANT: authenticated tiene INSERT directo en purchases';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_devolutions', 'DELETE'), 'FALLO GRANT: authenticated tiene DELETE directo en purchase_devolutions';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_orders', 'UPDATE'), 'FALLO GRANT: authenticated tiene UPDATE directo en purchase_orders';
  ASSERT NOT has_function_privilege('authenticated', 'public._require_company_roles(text[])', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _require_company_roles';
  ASSERT NOT has_function_privilege('authenticated', 'public._registrar_compra_core(uuid, uuid, jsonb, text, integer, numeric, text, numeric, boolean)', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _registrar_compra_core';
  ASSERT NOT has_function_privilege('authenticated', 'public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean)', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _registrar_compra_impl';

  RESET ROLE;

  RAISE NOTICE 'ETAPA 1 TEST SUITE OK: todas las aserciones de permisos, separación de funciones, bodega OC, acc_post_entry, perfil activo, aislamiento multiempresa y privilegios aprobaron.';
END $$;

ROLLBACK;
