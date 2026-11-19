-- supabase/tests/etapa1_permisos_y_seguridad_rollback_tests.sql
-- Suite transaccional no destructiva (BEGIN ... ROLLBACK) para verificar la Etapa 1
-- y el cierre de bloqueantes (migraciones 000065, 000066, 000067 y 000068):
--   1. Separación de funciones por rol (1A Contador incl. acc_post_entry limitado a borradores propios manual/ajuste,
--      2A Comprador/Almacén incl. separación creación vs aprobación OC, bloqueo de bodega asignada y máquina de estados OC,
--      3B Gerente/admin_empresa, 4A Vendedor)
--   2. Aislamiento multiempresa estricto (incluyendo cuentas admin globales sin bypass en DIAN/F300/F350/acc_post_entry/acc_*)
--   3. Auditoría obligatoria atómica (acc_close_period / acc_reopen_period sin silenciamiento en audit_log)
--   4. Atomicidad CxP (registrar_pago_proveedor / cxp_save_account / acc_post_supplier_payment con omisión solo si inactiva o fecha < start_date)
--   5. Bloqueo de perfiles inactivos (active = false) y endurecimiento DML en acc_* + funciones internas
--   6. Sin falsos positivos: ninguna prueba usa WHEN OTHERS THEN NULL; toda operación prohibida verifica
--      éxito inesperado FUERA del bloque EXCEPTION y exige el SQLSTATE/mensaje exacto esperado.
--
-- USO: Ejecutar en SQL Editor o psql contra una instancia donde ya se hayan aplicado
--      las migraciones 20261115000065, 20261116000066, 20261117000067 y 20261118000068.
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

  -- Sucursales y bodegas adicionales en Empresa A (incluye bodega inactiva y sin sucursal)
  v_br_a1       uuid := 'aaaaaaaa-4444-4000-8000-000000000001';
  v_br_a2       uuid := 'aaaaaaaa-4444-4000-8000-000000000002';
  v_wh_a        uuid := 'aaaaaaaa-1111-4000-8000-000000000001';
  v_wh_a2       uuid := 'aaaaaaaa-1111-4000-8000-000000000099';
  v_wh_br1      uuid := 'aaaaaaaa-1111-4000-8000-000000000011';
  v_wh_br2      uuid := 'aaaaaaaa-1111-4000-8000-000000000012';
  v_wh_inact_a  uuid := 'aaaaaaaa-1111-4000-8000-000000000013';
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
  v_po_no_wh_a        uuid;
  v_po_no_wh_item_a   uuid;
  v_po_br1_a          uuid;
  v_po_br1_item_a     uuid;
  v_po_br1_wh_a       uuid;
  v_po_br1_wh_item_a  uuid;
  v_po_cancel_a       uuid;
  v_po_cancel_item_a  uuid;
  v_po_inact_target_a uuid;
  v_po_inact_item_a   uuid;
  v_pur_gen_a         uuid;
  v_pur_br1_a         uuid;
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
  v_stock_wh_br1      numeric;
  v_json              jsonb;

  -- Snapshots de atomicidad para PRUEBA 5 (incluye desglose por warehouse_id y product_id)
  v_snap_purchases_cnt  int;
  v_snap_purchase_ids   jsonb;
  v_snap_prod_stock     numeric;
  v_snap_prod_b_stock   numeric;
  v_snap_products_stock jsonb;
  v_snap_kardex_cnt     int;
  v_snap_kardex_ids     jsonb;
  v_snap_wh_stock_sum   numeric;
  v_snap_wh_stock_rows  jsonb;
  v_snap_wh_moves_cnt   int;
  v_snap_wh_move_ids    jsonb;
  v_snap_cxp_owed       numeric;
  v_snap_cxp_b_owed     numeric;
  v_snap2_prod_stock     numeric;
  v_snap2_products_stock jsonb;
  v_snap2_cxp_owed       numeric;
  v_snap_pos_state      jsonb;
  v_snap_po_items_state jsonb;
  v_after_purchases_cnt  int;
  v_after_purchase_ids   jsonb;
  v_after_prod_stock     numeric;
  v_after_prod_b_stock   numeric;
  v_after_products_stock jsonb;
  v_after_kardex_cnt     int;
  v_after_kardex_ids     jsonb;
  v_after_wh_stock_sum   numeric;
  v_after_wh_stock_rows  jsonb;
  v_after_wh_moves_cnt   int;
  v_after_wh_move_ids    jsonb;
  v_after_cxp_owed       numeric;
  v_after_cxp_b_owed     numeric;
  v_after_pos_state      jsonb;
  v_after_po_items_state jsonb;
  v_after_po_status     text;
  v_after_po_wh         uuid;
  v_after_po_link       uuid;
  v_after_item_rec      numeric;
  v_wh_id_chk           uuid;
  v_br_id_chk           uuid;
  v_pay_chk             text;
  v_days_chk            int;

  -- Variables para PRUEBA 6 (cierre bloqueantes 1-5 / migración 000068)
  v_prev_date            date;
  v_prev_year            int;
  v_prev_month           int;
  v_prev_start           date;
  v_cur_year             int;
  v_cur_month            int;
  v_closing_6_id         uuid;
  v_snap_period_status   text;
  v_snap_closing_status  text;
  v_after_period_status  text;
  v_after_closing_status text;
  v_audit_cnt            int;
  v_snap_cxp_acc         uuid;
  v_snap_owed_6          numeric;
  v_snap_sp_cnt          int;
  v_snap_sa_cnt          int;
  v_snap_cash_cnt        int;
  v_snap_acc_cnt         int;
  v_after_sp_cnt         int;
  v_after_sa_cnt         int;
  v_after_cash_cnt       int;
  v_after_acc_cnt        int;
  v_pay_id_6             uuid;
  v_po_6_id              uuid;
  v_po_6_item            uuid;
  v_po_6_cancel_id       uuid;
  v_po_6_seq1_id         uuid;
  v_po_6_seq2_id         uuid;
  v_po_6_seq3_id         uuid;
  v_po_6_b1_id           uuid;
  v_po_6_num1            text;
  v_po_6_num2            text;
  v_po_6_num3            text;
  v_po_6_b1_num          text;
  v_cnt_b_seq            int;
  v_pay_pre_6            uuid;
  v_sup_debt_6           numeric;
  v_tbl                  text;

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

  INSERT INTO public.branches (id, company_id, name, code, is_main, active)
  VALUES
    (v_br_a1, v_co_a, 'Sucursal Norte A', 'SUC-A1', true,  true),
    (v_br_a2, v_co_a, 'Sucursal Sur A',   'SUC-A2', false, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.warehouses (id, company_id, branch_id, name, active)
  VALUES
    (v_wh_a,       v_co_a, NULL,    'Bodega Corporativa Sin Sede A', true),
    (v_wh_a2,      v_co_a, NULL,    'Bodega Secundaria Sin Sede A',  true),
    (v_wh_br1,     v_co_a, v_br_a1, 'Bodega Sucursal Norte A',       true),
    (v_wh_br2,     v_co_a, v_br_a2, 'Bodega Sucursal Sur A',         true),
    (v_wh_inact_a, v_co_a, v_br_a1, 'Bodega Inactiva A',             false),
    (v_wh_b,       v_co_b, NULL,    'Bodega Principal B',            true)
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

  -- Bloqueante 3: comprador NO puede autoaprobar ni aprobar OC (42501)
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.crear_orden_compra(
      v_sup_a,
      jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 5, 'unit_cost', 1200)),
      NULL, v_wh_a, 'credito', 45, current_date + 5, 'OC intento autoaprobar comprador', true
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3: comprador NO debe autoaprobar órdenes de compra'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3 (autoaprobar comprador): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_draft_a, 'approved');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3: comprador NO debe aprobar órdenes de compra'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3 (aprobar comprador): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  -- Crea la OC en borrador y luego la aprueba Dueño A (separación creación vs aprobación)
  v_po_app_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 5, 'unit_cost', 1200)),
    NULL, v_wh_a, 'credito', 45, current_date + 5, 'OC aprobada test', false
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

  -- Dueño A aprueba v_po_app_a antes de probar recepción de Almacén
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.cambiar_estado_orden_compra(v_po_app_a, 'approved');
  RESET ROLE;

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

  -- ===========================================================================
  -- PRUEBA 5 (Auditoría recibir_orden_compra + atomicidad ante rechazo)
  --   - Bloqueo de almacen con p_warehouse_id=NULL y target_warehouse_id=NULL (42501)
  --   - Rechazo de bodega inactiva (vía parámetro y vía target_warehouse_id desactivada)
  --   - Rechazo de bodega de otra empresa (v_wh_b -> 42501)
  --   - Rechazo de bodega de sucursal incompatible (incl. warehouses.branch_id IS NULL)
  --   - Rechazo de OC cancelled / ya received
  --   - Verificación estricta de CERO efectos colaterales ante rechazo (atomicidad)
  --   - Recepción legítima en inventario general (NULL) por comprador
  --   - Recepción legítima por almacén en bodega de sucursal compatible y efectos completos
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Coherencia en crear_orden_compra: no permite asignar bodega de sucursal incompatible ni branch_id IS NULL si p_branch_id != NULL
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.crear_orden_compra(
      v_sup_a,
      jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 2, 'unit_cost', 1500)),
      v_br_a1, v_wh_a, 'credito', 30, current_date + 3, 'OC incoherente wh sin sucursal', false
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: crear_orden_compra permitió bodega con branch_id NULL para OC de Sucursal 1'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%no pertenece a la sucursal%' THEN
    RAISE EXCEPTION 'FALLO OC (crear_orden_compra branch NULL): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  -- Crear órdenes de prueba en borrador como Comprador A
  v_po_no_wh_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 4, 'unit_cost', 1500)),
    NULL, NULL, 'credito', 30, current_date + 5, 'OC corporativa sin bodega', false
  );
  v_po_br1_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 3, 'unit_cost', 1500)),
    v_br_a1, NULL, 'credito', 30, current_date + 5, 'OC Sucursal 1 por asignar bodega', false
  );
  v_po_br1_wh_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 5, 'unit_cost', 1500)),
    v_br_a1, v_wh_br1, 'credito', 45, current_date + 5, 'OC Sucursal 1 con bodega asignada', false
  );
  v_po_cancel_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 2, 'unit_cost', 1500)),
    NULL, v_wh_a, 'credito', 30, current_date + 5, 'OC para cancelar', false
  );
  PERFORM public.cambiar_estado_orden_compra(v_po_cancel_a, 'cancelled');

  RESET ROLE;

  -- Dueño A aprueba las 3 órdenes activas creadas por Comprador A
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.cambiar_estado_orden_compra(v_po_no_wh_a, 'approved');
  PERFORM public.cambiar_estado_orden_compra(v_po_br1_a, 'approved');
  PERFORM public.cambiar_estado_orden_compra(v_po_br1_wh_a, 'approved');
  RESET ROLE;

  SELECT id INTO v_po_no_wh_item_a  FROM public.purchase_order_items WHERE po_id = v_po_no_wh_a  LIMIT 1;
  SELECT id INTO v_po_br1_item_a    FROM public.purchase_order_items WHERE po_id = v_po_br1_a    LIMIT 1;
  SELECT id INTO v_po_br1_wh_item_a FROM public.purchase_order_items WHERE po_id = v_po_br1_wh_a LIMIT 1;
  SELECT id INTO v_po_cancel_item_a FROM public.purchase_order_items WHERE po_id = v_po_cancel_a LIMIT 1;

  -- Orden apuntando a bodega que luego queda inactiva antes de la recepción (crea Comprador, aprueba Dueño)
  UPDATE public.warehouses SET active = true WHERE id = v_wh_inact_a;
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_po_inact_target_a := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 2, 'unit_cost', 1500)),
    v_br_a1, v_wh_inact_a, 'credito', 30, current_date + 5, 'OC con bodega luego desactivada', false
  );
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.cambiar_estado_orden_compra(v_po_inact_target_a, 'approved');
  RESET ROLE;
  UPDATE public.warehouses SET active = false WHERE id = v_wh_inact_a;
  SELECT id INTO v_po_inact_item_a FROM public.purchase_order_items WHERE po_id = v_po_inact_target_a LIMIT 1;

  -- Snapshot basal ANTES de las pruebas negativas (para verificar CERO cambios en BD ante rechazo)
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_purchases_cnt, v_snap_purchase_ids
    FROM public.purchases
   WHERE company_id IN (v_co_a, v_co_b);

  SELECT stock INTO v_snap_prod_stock   FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT stock INTO v_snap_prod_b_stock FROM public.products WHERE id = v_prod_b AND company_id = v_co_b;
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'company_id', p.company_id,
               'stock', p.stock
             )
             ORDER BY p.company_id, p.id
           ),
           '[]'::jsonb
         )
    INTO v_snap_products_stock
    FROM public.products p
   WHERE p.company_id IN (v_co_a, v_co_b);

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_kardex_cnt, v_snap_kardex_ids
    FROM public.kardex
   WHERE company_id IN (v_co_a, v_co_b);

  SELECT coalesce(sum(ws.quantity), 0),
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'company_id', ws.company_id,
               'warehouse_id', ws.warehouse_id,
               'product_id', ws.product_id,
               'quantity', ws.quantity,
               'reserved_quantity', ws.reserved_quantity
             )
             ORDER BY ws.company_id, ws.warehouse_id, ws.product_id
           ),
           '[]'::jsonb
         )
    INTO v_snap_wh_stock_sum, v_snap_wh_stock_rows
    FROM public.warehouse_stock ws
   WHERE ws.company_id IN (v_co_a, v_co_b);

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_wh_moves_cnt, v_snap_wh_move_ids
    FROM public.warehouse_movements
   WHERE company_id IN (v_co_a, v_co_b);

  v_snap_cxp_owed   := public._supplier_owed(v_co_a, v_sup_a);
  v_snap_cxp_b_owed := public._supplier_owed(v_co_b, v_sup_b);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', po.id,
               'status', po.status,
               'target_warehouse_id', po.target_warehouse_id,
               'linked_purchase_id', po.linked_purchase_id,
               'received_at', po.received_at
             )
             ORDER BY po.id
           ),
           '[]'::jsonb
         )
    INTO v_snap_pos_state
    FROM public.purchase_orders po
   WHERE po.company_id IN (v_co_a, v_co_b);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', poi.id,
               'po_id', poi.po_id,
               'received_qty', poi.received_qty,
               'rejected_qty', poi.rejected_qty,
               'unit_cost', poi.unit_cost
             )
             ORDER BY poi.id
           ),
           '[]'::jsonb
         )
    INTO v_snap_po_items_state
    FROM public.purchase_order_items poi
   WHERE poi.company_id IN (v_co_a, v_co_b);

  -- 5.1 Almacén NO puede recibir con p_warehouse_id = NULL y target_warehouse_id = NULL (42501)
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_no_wh_a, NULL,
      jsonb_build_array(jsonb_build_object('item_id', v_po_no_wh_item_a, 'received_now', 2)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: almacén NO debe recibir en inventario general (p_warehouse_id=NULL y target_warehouse_id=NULL)'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO OC (almacén sin bodega): se esperaba 42501 y ocurrió [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.1): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.2 Recepción en bodega inactiva (pasada por parámetro cuando target_warehouse_id=NULL) -> P0001
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_a, v_wh_inact_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: no se debe recibir en bodega inactiva (v_wh_inact_a)'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%inactiva%' THEN
    RAISE EXCEPTION 'FALLO OC (bodega inactiva param): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.2): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.2b Recepción cuando la bodega target_warehouse_id asignada quedó inactiva -> P0001
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_inact_target_a, NULL,
      jsonb_build_array(jsonb_build_object('item_id', v_po_inact_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: no se debe recibir en OC cuya target_warehouse_id quedó inactiva'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%inactiva%' THEN
    RAISE EXCEPTION 'FALLO OC (target_warehouse_id inactiva): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.2b): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.3 Recepción con bodega de sucursal incompatible: otra sucursal (v_wh_br2) -> P0001
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_a, v_wh_br2,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: no debe recibir OC de Sucursal 1 en bodega de Sucursal 2'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%no pertenece a la sucursal%' THEN
    RAISE EXCEPTION 'FALLO OC (sucursal incompatible br2): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.3): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.4 Caso crítico explícito: purchase_orders.branch_id != NULL (v_br_a1) y warehouses.branch_id IS NULL (v_wh_a) -> P0001
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: bodega con warehouses.branch_id IS NULL NO debe recibir OC con branch_id asignado'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%no pertenece a la sucursal%' THEN
    RAISE EXCEPTION 'FALLO OC (wh.branch_id NULL con po.branch_id): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.4): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.5 Recepción de OC cancelada -> P0001
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_cancel_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_cancel_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: NO se debe recibir una orden de compra cancelada'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%aprobadas, enviadas o parciales%' THEN
    RAISE EXCEPTION 'FALLO OC (cancelled): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.5): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  -- 5.6 Almacén tampoco puede recibir OC de sucursal en bodega de otra empresa (v_wh_b -> 42501)
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_wh_a, v_wh_b,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_wh_item_a, 'received_now', 2)),
      'credito', 45
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: almacén NO debe recibir en bodega de otra empresa'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO OC (bodega otra empresa almacén): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (5.6): alteró products.stock en alguna empresa tras rechazo';

  -- También comprador debe fallar al intentar recibir con bodega de Empresa B o con bodega wh.branch_id IS NULL para OC con branch_id
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_no_wh_a, v_wh_b,
      jsonb_build_array(jsonb_build_object('item_id', v_po_no_wh_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: comprador NO debe recibir en bodega de Empresa B'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO OC (comprador bodega B): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'company_id', p.company_id, 'stock', p.stock) ORDER BY p.company_id, p.id), '[]'::jsonb)
    INTO v_after_products_stock FROM public.products p WHERE p.company_id IN (v_co_a, v_co_b);
  ASSERT v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD (comprador bodega B): alteró products.stock en alguna empresa tras rechazo';
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_item_a, 'received_now', 1)),
      'credito', 30
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: comprador NO debe recibir OC con branch_id en bodega con branch_id IS NULL'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%no pertenece a la sucursal%' THEN
    RAISE EXCEPTION 'FALLO OC (comprador wh.branch_id NULL): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- 5.7 VERIFICACIÓN ESTRICTA DE ATOMICIDAD: todos los rechazos anteriores dejaron CERO cambios
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_purchases_cnt, v_after_purchase_ids
    FROM public.purchases
   WHERE company_id IN (v_co_a, v_co_b);

  SELECT stock INTO v_after_prod_stock   FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT stock INTO v_after_prod_b_stock FROM public.products WHERE id = v_prod_b AND company_id = v_co_b;
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'company_id', p.company_id,
               'stock', p.stock
             )
             ORDER BY p.company_id, p.id
           ),
           '[]'::jsonb
         )
    INTO v_after_products_stock
    FROM public.products p
   WHERE p.company_id IN (v_co_a, v_co_b);

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_kardex_cnt, v_after_kardex_ids
    FROM public.kardex
   WHERE company_id IN (v_co_a, v_co_b);

  SELECT coalesce(sum(ws.quantity), 0),
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'company_id', ws.company_id,
               'warehouse_id', ws.warehouse_id,
               'product_id', ws.product_id,
               'quantity', ws.quantity,
               'reserved_quantity', ws.reserved_quantity
             )
             ORDER BY ws.company_id, ws.warehouse_id, ws.product_id
           ),
           '[]'::jsonb
         )
    INTO v_after_wh_stock_sum, v_after_wh_stock_rows
    FROM public.warehouse_stock ws
   WHERE ws.company_id IN (v_co_a, v_co_b);

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_wh_moves_cnt, v_after_wh_move_ids
    FROM public.warehouse_movements
   WHERE company_id IN (v_co_a, v_co_b);

  v_after_cxp_owed   := public._supplier_owed(v_co_a, v_sup_a);
  v_after_cxp_b_owed := public._supplier_owed(v_co_b, v_sup_b);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', po.id,
               'status', po.status,
               'target_warehouse_id', po.target_warehouse_id,
               'linked_purchase_id', po.linked_purchase_id,
               'received_at', po.received_at
             )
             ORDER BY po.id
           ),
           '[]'::jsonb
         )
    INTO v_after_pos_state
    FROM public.purchase_orders po
   WHERE po.company_id IN (v_co_a, v_co_b);

  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', poi.id,
               'po_id', poi.po_id,
               'received_qty', poi.received_qty,
               'rejected_qty', poi.rejected_qty,
               'unit_cost', poi.unit_cost
             )
             ORDER BY poi.id
           ),
           '[]'::jsonb
         )
    INTO v_after_po_items_state
    FROM public.purchase_order_items poi
   WHERE poi.company_id IN (v_co_a, v_co_b);

  ASSERT v_after_purchases_cnt = v_snap_purchases_cnt
     AND v_after_purchase_ids  IS NOT DISTINCT FROM v_snap_purchase_ids,
    'FALLO ATOMICIDAD: una recepción rechazada insertó o alteró registros en purchases';
  ASSERT v_after_prod_stock    = v_snap_prod_stock
     AND v_after_prod_b_stock  = v_snap_prod_b_stock
     AND v_after_products_stock IS NOT DISTINCT FROM v_snap_products_stock,
    'FALLO ATOMICIDAD: una recepción rechazada alteró products.stock en alguna de las empresas';
  ASSERT v_after_kardex_cnt    = v_snap_kardex_cnt
     AND v_after_kardex_ids    IS NOT DISTINCT FROM v_snap_kardex_ids,
    'FALLO ATOMICIDAD: una recepción rechazada insertó o alteró movimientos en kardex';
  ASSERT v_after_wh_stock_sum  = v_snap_wh_stock_sum
     AND v_after_wh_stock_rows IS NOT DISTINCT FROM v_snap_wh_stock_rows,
    'FALLO ATOMICIDAD: una recepción rechazada creó o modificó existencias en warehouse_stock por (warehouse_id, product_id)';
  ASSERT v_after_wh_moves_cnt  = v_snap_wh_moves_cnt
     AND v_after_wh_move_ids   IS NOT DISTINCT FROM v_snap_wh_move_ids,
    'FALLO ATOMICIDAD: una recepción rechazada insertó o alteró registros en warehouse_movements';
  ASSERT v_after_cxp_owed      = v_snap_cxp_owed
     AND v_after_cxp_b_owed    = v_snap_cxp_b_owed,
    'FALLO ATOMICIDAD: una recepción rechazada alteró la obligación CxP con el proveedor';
  ASSERT v_after_pos_state     IS NOT DISTINCT FROM v_snap_pos_state,
    'FALLO ATOMICIDAD: una recepción rechazada alteró purchase_orders';
  ASSERT v_after_po_items_state IS NOT DISTINCT FROM v_snap_po_items_state,
    'FALLO ATOMICIDAD: una recepción rechazada alteró purchase_order_items';

  -- 5.8 Recepción legítima en inventario general (NULL) por rol autorizado (comprador)
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pur_gen_a := public.recibir_orden_compra(
    v_po_no_wh_a, NULL,
    jsonb_build_array(jsonb_build_object('item_id', v_po_no_wh_item_a, 'received_now', 4)),
    'credito', 30
  );
  ASSERT v_pur_gen_a IS NOT NULL, 'FALLO OC: comprador debe poder recibir OC sin bodega en inventario general (NULL)';

  RESET ROLE;

  SELECT warehouse_id, payment_method, credit_days
    INTO v_wh_id_chk, v_pay_chk, v_days_chk
    FROM public.purchases WHERE id = v_pur_gen_a;
  ASSERT v_wh_id_chk IS NULL AND v_pay_chk = 'credito' AND v_days_chk = 30,
    'FALLO OC: la compra en inventario general debe quedar con warehouse_id IS NULL y condiciones intactas';

  SELECT count(*) INTO v_cnt FROM public.warehouse_movements
   WHERE company_id = v_co_a AND reference_type = 'purchase_order' AND reference_id = v_po_no_wh_a;
  ASSERT v_cnt = 0, 'FALLO OC: la recepción en inventario general no debe crear movimientos de bodega';

  SELECT stock INTO v_after_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  ASSERT v_after_prod_stock = v_snap_prod_stock + 4,
    'FALLO OC: la recepción en inventario general debe sumar 4 a products.stock';

  ASSERT public._supplier_owed(v_co_a, v_sup_a) = v_snap_cxp_owed + 6000,
    'FALLO OC: la recepción en inventario general a crédito debe incrementar CxP en 6000';

  -- 5.9 Recepción legítima completa por almacén con sucursal y bodega compatibles + verificación integral de efectos
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pur_br1_a := public.recibir_orden_compra(
    v_po_br1_wh_a, NULL,
    jsonb_build_array(jsonb_build_object('item_id', v_po_br1_wh_item_a, 'received_now', 5)),
    NULL, NULL
  );
  ASSERT v_pur_br1_a IS NOT NULL, 'FALLO OC: almacén debe recibir legítimamente OC de sucursal con bodega asignada compatible';

  -- Almacén también puede recibir OC sin bodega previa cuando selecciona una bodega activa compatible de la sucursal
  ASSERT public.recibir_orden_compra(
    v_po_br1_a, v_wh_br1,
    jsonb_build_array(jsonb_build_object('item_id', v_po_br1_item_a, 'received_now', 3)),
    NULL, NULL
  ) IS NOT NULL, 'FALLO OC: almacén debe poder recibir OC sin bodega previa indicando bodega activa compatible de la sucursal';

  -- Snapshot previo al intento rechazado sobre OC ya recibida ('received')
  RESET ROLE;

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_purchases_cnt, v_snap_purchase_ids
    FROM public.purchases
   WHERE company_id IN (v_co_a, v_co_b);
  SELECT stock INTO v_snap2_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'company_id', p.company_id,
               'stock', p.stock
             )
             ORDER BY p.company_id, p.id
           ),
           '[]'::jsonb
         )
    INTO v_snap2_products_stock
    FROM public.products p
   WHERE p.company_id IN (v_co_a, v_co_b);
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_kardex_cnt, v_snap_kardex_ids
    FROM public.kardex
   WHERE company_id IN (v_co_a, v_co_b);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'company_id', ws.company_id,
               'warehouse_id', ws.warehouse_id,
               'product_id', ws.product_id,
               'quantity', ws.quantity,
               'reserved_quantity', ws.reserved_quantity
             )
             ORDER BY ws.company_id, ws.warehouse_id, ws.product_id
           ),
           '[]'::jsonb
         )
    INTO v_snap_wh_stock_rows
    FROM public.warehouse_stock ws
   WHERE ws.company_id IN (v_co_a, v_co_b);
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_snap_wh_moves_cnt, v_snap_wh_move_ids
    FROM public.warehouse_movements
   WHERE company_id IN (v_co_a, v_co_b);
  v_snap2_cxp_owed := public._supplier_owed(v_co_a, v_sup_a);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', po.id,
               'status', po.status,
               'target_warehouse_id', po.target_warehouse_id,
               'linked_purchase_id', po.linked_purchase_id,
               'received_at', po.received_at
             )
             ORDER BY po.id
           ),
           '[]'::jsonb
         )
    INTO v_snap_pos_state
    FROM public.purchase_orders po
   WHERE po.company_id IN (v_co_a, v_co_b);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', poi.id,
               'po_id', poi.po_id,
               'received_qty', poi.received_qty,
               'rejected_qty', poi.rejected_qty,
               'unit_cost', poi.unit_cost
             )
             ORDER BY poi.id
           ),
           '[]'::jsonb
         )
    INTO v_snap_po_items_state
    FROM public.purchase_order_items poi
   WHERE poi.company_id IN (v_co_a, v_co_b);

  -- Intentar recibir nuevamente una OC ya recibida ('received') -> P0001
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_br1_wh_a, v_wh_br1,
      jsonb_build_array(jsonb_build_object('item_id', v_po_br1_wh_item_a, 'received_now', 1)),
      NULL, NULL
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO OC: NO se debe recibir una orden ya marcada como received'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%aprobadas, enviadas o parciales%' THEN
    RAISE EXCEPTION 'FALLO OC (received): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_purchases_cnt, v_after_purchase_ids
    FROM public.purchases
   WHERE company_id IN (v_co_a, v_co_b);
  SELECT stock INTO v_after_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'company_id', p.company_id,
               'stock', p.stock
             )
             ORDER BY p.company_id, p.id
           ),
           '[]'::jsonb
         )
    INTO v_after_products_stock
    FROM public.products p
   WHERE p.company_id IN (v_co_a, v_co_b);
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_kardex_cnt, v_after_kardex_ids
    FROM public.kardex
   WHERE company_id IN (v_co_a, v_co_b);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'company_id', ws.company_id,
               'warehouse_id', ws.warehouse_id,
               'product_id', ws.product_id,
               'quantity', ws.quantity,
               'reserved_quantity', ws.reserved_quantity
             )
             ORDER BY ws.company_id, ws.warehouse_id, ws.product_id
           ),
           '[]'::jsonb
         )
    INTO v_after_wh_stock_rows
    FROM public.warehouse_stock ws
   WHERE ws.company_id IN (v_co_a, v_co_b);
  SELECT count(*), coalesce(jsonb_agg(id ORDER BY id), '[]'::jsonb)
    INTO v_after_wh_moves_cnt, v_after_wh_move_ids
    FROM public.warehouse_movements
   WHERE company_id IN (v_co_a, v_co_b);
  v_after_cxp_owed := public._supplier_owed(v_co_a, v_sup_a);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', po.id,
               'status', po.status,
               'target_warehouse_id', po.target_warehouse_id,
               'linked_purchase_id', po.linked_purchase_id,
               'received_at', po.received_at
             )
             ORDER BY po.id
           ),
           '[]'::jsonb
         )
    INTO v_after_pos_state
    FROM public.purchase_orders po
   WHERE po.company_id IN (v_co_a, v_co_b);
  SELECT coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', poi.id,
               'po_id', poi.po_id,
               'received_qty', poi.received_qty,
               'rejected_qty', poi.rejected_qty,
               'unit_cost', poi.unit_cost
             )
             ORDER BY poi.id
           ),
           '[]'::jsonb
         )
    INTO v_after_po_items_state
    FROM public.purchase_order_items poi
   WHERE poi.company_id IN (v_co_a, v_co_b);

  ASSERT v_after_purchases_cnt  = v_snap_purchases_cnt AND v_after_purchase_ids IS NOT DISTINCT FROM v_snap_purchase_ids,
    'FALLO ATOMICIDAD (received): creó o alteró compras tras rechazo';
  ASSERT v_after_prod_stock     = v_snap2_prod_stock
     AND v_after_products_stock IS NOT DISTINCT FROM v_snap2_products_stock,
    'FALLO ATOMICIDAD (received): alteró products.stock en alguna de las empresas tras rechazo';
  ASSERT v_after_kardex_cnt     = v_snap_kardex_cnt AND v_after_kardex_ids IS NOT DISTINCT FROM v_snap_kardex_ids,
    'FALLO ATOMICIDAD (received): creó o alteró kardex tras rechazo';
  ASSERT v_after_wh_stock_rows  IS NOT DISTINCT FROM v_snap_wh_stock_rows,
    'FALLO ATOMICIDAD (received): creó o modificó warehouse_stock por (warehouse_id, product_id) tras rechazo';
  ASSERT v_after_wh_moves_cnt   = v_snap_wh_moves_cnt AND v_after_wh_move_ids IS NOT DISTINCT FROM v_snap_wh_move_ids,
    'FALLO ATOMICIDAD (received): creó o alteró warehouse_movements tras rechazo';
  ASSERT v_after_cxp_owed       = v_snap2_cxp_owed,
    'FALLO ATOMICIDAD (received): alteró obligación CxP tras rechazo';
  ASSERT v_after_pos_state      IS NOT DISTINCT FROM v_snap_pos_state
     AND v_after_po_items_state IS NOT DISTINCT FROM v_snap_po_items_state,
    'FALLO ATOMICIDAD (received): alteró OC o sus renglones tras rechazo';

  SELECT branch_id, warehouse_id, payment_method, credit_days
    INTO v_br_id_chk, v_wh_id_chk, v_pay_chk, v_days_chk
    FROM public.purchases WHERE id = v_pur_br1_a;
  ASSERT v_br_id_chk = v_br_a1 AND v_wh_id_chk = v_wh_br1 AND v_pay_chk = 'credito' AND v_days_chk = 45,
    'FALLO OC: purchases debe quedar vinculada a v_br_a1, v_wh_br1, credito y 45 días';

  SELECT coalesce(quantity, 0) INTO v_stock_wh_br1
    FROM public.warehouse_stock WHERE company_id = v_co_a AND warehouse_id = v_wh_br1 AND product_id = v_prod_a;
  ASSERT coalesce(v_stock_wh_br1, 0) = 8,
    'FALLO OC: warehouse_stock de v_wh_br1 debió incrementar en 8 unidades (5 + 3)';

  SELECT count(*) INTO v_cnt FROM public.warehouse_movements
   WHERE company_id = v_co_a AND warehouse_id = v_wh_br1 AND product_id = v_prod_a
     AND movement_type = 'entry' AND quantity_delta = 5
     AND reference_type = 'purchase_order' AND reference_id = v_po_br1_wh_a;
  ASSERT v_cnt = 1, 'FALLO OC: debe existir el movimiento entry en warehouse_movements para v_po_br1_wh_a';

  SELECT count(*) INTO v_cnt FROM public.kardex
   WHERE company_id = v_co_a AND product_id = v_prod_a
     AND reference_type = 'purchase' AND reference_id = v_pur_br1_a
     AND type = 'entrada' AND quantity = 5 AND seq_verified = true;
  ASSERT v_cnt = 1, 'FALLO OC: debe existir entrada verificada en kardex para v_pur_br1_a';

  SELECT status, target_warehouse_id, linked_purchase_id
    INTO v_after_po_status, v_after_po_wh, v_after_po_link
    FROM public.purchase_orders WHERE id = v_po_br1_wh_a;
  ASSERT v_after_po_status = 'received' AND v_after_po_wh = v_wh_br1 AND v_after_po_link = v_pur_br1_a,
    'FALLO OC: purchase_orders debió pasar a received y quedar enlazada a v_pur_br1_a';

  SELECT target_warehouse_id, status INTO v_after_po_wh, v_after_po_status
    FROM public.purchase_orders WHERE id = v_po_br1_a;
  ASSERT v_after_po_status = 'received' AND v_after_po_wh = v_wh_br1,
    'FALLO OC: v_po_br1_a debió quedar recibida con target_warehouse_id = v_wh_br1';

  SELECT received_qty INTO v_after_item_rec
    FROM public.purchase_order_items WHERE id = v_po_br1_wh_item_a;
  ASSERT v_after_item_rec = 5, 'FALLO OC: purchase_order_items.received_qty debió quedar en 5';

  SELECT stock INTO v_after_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  ASSERT v_after_prod_stock = v_snap_prod_stock + 4 + 5 + 3,
    'FALLO OC: products.stock debe acumular las tres recepciones legítimas (+12)';

  ASSERT public._supplier_owed(v_co_a, v_sup_a) = v_snap_cxp_owed + 6000 + 7500 + 4500,
    'FALLO OC: CxP del proveedor debe reflejar exactamente las compras a crédito recibidas (+18000)';

  -- ===========================================================================
  -- PRUEBA 6 (Cierre Bloqueantes 1–5 / Migración 000068):
  --   6.1 Bloqueante 1: Auditoría obligatoria atómica en acc_close_period y acc_reopen_period
  --   6.2–6.4 Bloqueante 2: Atomicidad de registrar_pago_proveedor, acc_post_supplier_payment y cxp_save_account
  --   6.5–6.11 Bloqueantes 3–4: Separación creación/aprobación OC, máquina de estados y recepciones parciales
  --   6.12–6.14 Bloqueante 5: DML acc_* cerrado a authenticated/anon y platform_admin_company_select (solo lectura propia)
  --   6.15 Endurecimiento 000068 (Bloqueante 1): active = true con start_date IS NULL falla y hace rollback (no omite)
  --   6.16 Endurecimiento 000068 (Bloqueante 3): purchase_order_counters cerrado y UNIQUE (company_id, po_number)
  -- ===========================================================================

  -- 6.1 Bloqueante 1: Si falla audit_log, acc_reopen_period revierte por completo
  v_prev_date  := (date_trunc('month', current_date) - interval '1 month')::date;
  v_prev_year  := extract(year from v_prev_date)::int;
  v_prev_month := extract(month from v_prev_date)::int;
  v_prev_start := date_trunc('month', v_prev_date)::date;
  v_cur_year   := extract(year from current_date)::int;
  v_cur_month  := extract(month from current_date)::int;

  UPDATE public.acc_settings
     SET start_date = greatest(start_date, v_prev_start)
   WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_closing_6_id := public.acc_close_period(v_prev_year, v_prev_month, 'Cierre prueba bloqueante 1', true);
  ASSERT v_closing_6_id IS NOT NULL, 'FALLO BLOQUEANTE 1: cierre del periodo anterior debe emitir registro acc_closings';

  RESET ROLE;

  -- Forzar fallo controlado en audit_log al reabrir sin tocar migraciones históricas
  EXECUTE 'ALTER TABLE public.audit_log ADD CONSTRAINT chk_test_block_reopen_audit CHECK (action <> ''reapertura_contable'')';

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_reopen_period(v_prev_year, v_prev_month, 'Intento reapertura con fallo audit_log');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 1: acc_reopen_period NO debe completar si falla audit_log'; END IF;
  IF v_err_state <> '23514' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 1 (reopen fallo audit_log): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  SELECT status INTO v_after_period_status FROM public.acc_periods WHERE company_id = v_co_a AND year = v_prev_year AND month = v_prev_month;
  SELECT status INTO v_after_closing_status FROM public.acc_closings WHERE id = v_closing_6_id;
  ASSERT v_after_period_status = 'cerrado' AND v_after_closing_status = 'cerrado',
    'FALLO ATOMICIDAD BLOQUEANTE 1: fallo en audit_log dejó acc_periods o acc_closings alterados';

  EXECUTE 'ALTER TABLE public.audit_log DROP CONSTRAINT chk_test_block_reopen_audit';

  -- También probar fallo de audit_log en acc_close_period después de reabrir legítimamente
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.acc_reopen_period(v_prev_year, v_prev_month, 'Reapertura válida tras restaurar audit_log');

  RESET ROLE;

  SELECT status INTO v_after_period_status FROM public.acc_periods WHERE company_id = v_co_a AND year = v_prev_year AND month = v_prev_month;
  SELECT status INTO v_after_closing_status FROM public.acc_closings WHERE id = v_closing_6_id;
  SELECT count(*) INTO v_audit_cnt FROM public.audit_log
   WHERE company_id = v_co_a AND table_name = 'acc_closings' AND record_id = v_closing_6_id AND action = 'reapertura_contable';
  ASSERT v_after_period_status = 'abierto' AND v_after_closing_status = 'reabierto' AND v_audit_cnt = 1,
    'FALLO BLOQUEANTE 1: reapertura válida debió actualizar acc_periods/acc_closings y escribir en audit_log';

  EXECUTE 'ALTER TABLE public.audit_log ADD CONSTRAINT chk_test_block_close_audit CHECK (action <> ''cierre_contable'')';

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_close_period(v_prev_year, v_prev_month, 'Intento cierre con fallo audit_log', true);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 1: acc_close_period NO debe completar si falla audit_log'; END IF;
  IF v_err_state <> '23514' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 1 (close fallo audit_log): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  SELECT status INTO v_after_period_status FROM public.acc_periods WHERE company_id = v_co_a AND year = v_prev_year AND month = v_prev_month;
  SELECT count(*) INTO v_cnt FROM public.acc_closings
   WHERE company_id = v_co_a AND year = v_prev_year AND month = v_prev_month AND status = 'cerrado';
  ASSERT v_after_period_status = 'abierto' AND v_cnt = 0,
    'FALLO ATOMICIDAD BLOQUEANTE 1: fallo en audit_log durante cierre dejó acc_periods o acc_closings alterados';

  EXECUTE 'ALTER TABLE public.audit_log DROP CONSTRAINT chk_test_block_close_audit';

  -- Restaurar start_date original de prueba
  UPDATE public.acc_settings SET start_date = (current_date - 30) WHERE company_id = v_co_a;

  -- 6.2 Bloqueante 2: Con contabilidad activa en fecha >= start_date, si falta CxP o periodo actual está cerrado,
  -- registrar_pago_proveedor falla y hace rollback íntegro (supplier_payments, supplier_allocations, cash_entries, acc_entries)
  DELETE FROM public.cxp_settings WHERE company_id = v_co_a;

  SELECT count(*) INTO v_snap_sp_cnt   FROM public.supplier_payments    WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_sa_cnt   FROM public.supplier_allocations WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_cash_cnt FROM public.cash_entries         WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_acc_cnt  FROM public.acc_entries          WHERE company_id = v_co_a;
  v_snap_owed_6 := public._supplier_owed(v_co_a, v_sup_a);

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 500, 'efectivo', 'Falta cuenta CxP', gen_random_uuid());
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 2: registrar_pago_proveedor NO debe completar si falta cxp_settings con contabilidad activa'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%Falta configurar la cuenta por pagar%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 2 (falta CxP): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT count(*) INTO v_after_sp_cnt   FROM public.supplier_payments    WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_sa_cnt   FROM public.supplier_allocations WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_cash_cnt FROM public.cash_entries         WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_acc_cnt  FROM public.acc_entries          WHERE company_id = v_co_a;
  ASSERT v_after_sp_cnt = v_snap_sp_cnt AND v_after_sa_cnt = v_snap_sa_cnt
     AND v_after_cash_cnt = v_snap_cash_cnt AND v_after_acc_cnt = v_snap_acc_cnt
     AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6,
    'FALLO ATOMICIDAD BLOQUEANTE 2 (falta CxP): pago fallido dejó rastro en supplier_payments/allocations/caja/CxP';

  -- 6.2b Restaurar CxP pero cerrar el periodo actual -> registrar_pago_proveedor también revierte todo
  INSERT INTO public.cxp_settings (company_id, account_id)
  VALUES (v_co_a, v_acc_cxp_a)
  ON CONFLICT (company_id) DO UPDATE SET account_id = EXCLUDED.account_id;

  INSERT INTO public.acc_periods (company_id, year, month, status, closed_at, closed_by)
  VALUES (v_co_a, v_cur_year, v_cur_month, 'cerrado', now(), v_u_dueno_a)
  ON CONFLICT (company_id, year, month) DO UPDATE SET status = 'cerrado', closed_at = now(), closed_by = v_u_dueno_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 500, 'efectivo', 'Periodo actual cerrado', gen_random_uuid());
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 2: registrar_pago_proveedor NO debe completar con periodo contable actual cerrado'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%cerrado%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 2 (periodo cerrado): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT count(*) INTO v_after_sp_cnt   FROM public.supplier_payments    WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_sa_cnt   FROM public.supplier_allocations WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_cash_cnt FROM public.cash_entries         WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_acc_cnt  FROM public.acc_entries          WHERE company_id = v_co_a;
  ASSERT v_after_sp_cnt = v_snap_sp_cnt AND v_after_sa_cnt = v_snap_sa_cnt
     AND v_after_cash_cnt = v_snap_cash_cnt AND v_after_acc_cnt = v_snap_acc_cnt
     AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6,
    'FALLO ATOMICIDAD BLOQUEANTE 2 (periodo cerrado): pago fallido dejó rastro en supplier_payments/allocations/caja/CxP';

  DELETE FROM public.acc_periods WHERE company_id = v_co_a AND year = v_cur_year AND month = v_cur_month;

  -- 6.3 Bloqueante 2 (omisión legítima): si acc_settings.active = false O payment_date < start_date, el pago SÍ completa sin asiento contable
  UPDATE public.acc_settings SET active = false WHERE company_id = v_co_a;
  DELETE FROM public.cxp_settings WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pay_id_6 := public.registrar_pago_proveedor(v_sup_a, 500, 'efectivo', 'Omisión legítima contabilidad inactiva', gen_random_uuid());
  ASSERT v_pay_id_6 IS NOT NULL, 'FALLO BLOQUEANTE 2: pago con contabilidad inactiva debe permitirse';

  RESET ROLE;

  SELECT count(*) INTO v_after_acc_cnt FROM public.acc_entries
   WHERE company_id = v_co_a AND source_type = 'pago_proveedor' AND source_id = v_pay_id_6;
  ASSERT v_after_acc_cnt = 0 AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6 - 500,
    'FALLO BLOQUEANTE 2: con contabilidad inactiva no debe crear asiento y sí disminuir CxP en 500';

  UPDATE public.acc_settings SET active = true, start_date = (current_date + 7) WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pay_id_6 := public.registrar_pago_proveedor(v_sup_a, 500, 'efectivo', 'Omisión legítima fecha < start_date', gen_random_uuid());
  ASSERT v_pay_id_6 IS NOT NULL, 'FALLO BLOQUEANTE 2: pago anterior a start_date debe permitirse';

  RESET ROLE;

  SELECT count(*) INTO v_after_acc_cnt FROM public.acc_entries
   WHERE company_id = v_co_a AND source_type = 'pago_proveedor' AND source_id = v_pay_id_6;
  ASSERT v_after_acc_cnt = 0 AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6 - 1000,
    'FALLO BLOQUEANTE 2: con fecha < start_date no debe crear asiento y sí disminuir CxP en 500 adicionales';

  -- 6.4 Bloqueante 2 (cxp_save_account): si acc_post_pending falla con contabilidad activa, propaga error y revierte cxp_settings
  UPDATE public.acc_settings SET active = true, start_date = (current_date - 30) WHERE company_id = v_co_a;
  INSERT INTO public.acc_periods (company_id, year, month, status, closed_at, closed_by)
  VALUES (v_co_a, v_cur_year, v_cur_month, 'cerrado', now(), v_u_dueno_a)
  ON CONFLICT (company_id, year, month) DO UPDATE SET status = 'cerrado', closed_at = now(), closed_by = v_u_dueno_a;

  SELECT account_id INTO v_snap_cxp_acc FROM public.cxp_settings WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cxp_save_account(v_acc_cxp_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 2: cxp_save_account NO debe silenciar fallos de acc_post_pending'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%cerrado%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 2 (cxp_save_account fallo acc_post_pending): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT account_id INTO v_snap_cxp_acc FROM public.cxp_settings WHERE company_id = v_co_a;
  ASSERT v_snap_cxp_acc IS NULL,
    'FALLO ATOMICIDAD BLOQUEANTE 2: cxp_save_account dejó alterada cxp_settings tras fallo de acc_post_pending';

  DELETE FROM public.acc_periods WHERE company_id = v_co_a AND year = v_cur_year AND month = v_cur_month;
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  ASSERT public.cxp_save_account(v_acc_cxp_a) IS NOT NULL,
    'FALLO BLOQUEANTE 2: cxp_save_account debe completar correctamente con periodo abierto';
  RESET ROLE;

  -- 6.5–6.11 Bloqueantes 3 y 4: Separación creación/aprobación OC, máquina de estados estricta y recepciones parciales
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_po_6_id := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 10, 'unit_cost', 2000)),
    v_br_a1, v_wh_br1, 'credito', 30, current_date + 5, 'OC ciclo completo bloqueantes 3-4', false
  );
  v_po_6_cancel_id := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 2, 'unit_cost', 2000)),
    NULL, v_wh_a, 'credito', 30, current_date + 5, 'OC cancelable en borrador', false
  );

  -- 6.7 Transición ilegal: draft -> sent bloqueada
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'sent');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: no debe pasar de draft a sent sin aprobación previa'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%aprobarse%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (draft->sent): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  -- Cancelación legítima desde draft
  PERFORM public.cambiar_estado_orden_compra(v_po_6_cancel_id, 'cancelled');

  -- Transición ilegal desde cancelled -> approved/sent/cancelled
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_cancel_id, 'sent');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: orden cancelada NO debe transicionar'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%cerrada o cancelada%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (cancelled->sent): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- 6.6 Gerente NO puede aprobar OC (consulta únicamente según matriz) -> 42501
  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'approved');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3: gerente NO debe aprobar órdenes de compra'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 3 (gerente aprobar OC): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  -- 6.8 Admin_empresa SÍ aprueba draft -> approved y bloquea approved -> approved
  PERFORM set_config('request.jwt.claim.sub', v_u_adm_emp_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_adm_emp_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'approved');

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'approved');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: no debe re-aprobar orden ya aprobada'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%Transición inválida%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (approved->approved): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- 6.9 Comprador marca approved -> sent y no puede retroceder sent -> approved
  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'sent');

  RESET ROLE;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'approved');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: orden sent NO puede retroceder a approved'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%Una orden enviada%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (sent->approved): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- 6.10 Dos recepciones parciales sucesivas (4 + 6 = 10) -> partial -> received + bloqueo de cancelación en partial
  SELECT id INTO v_po_6_item FROM public.purchase_order_items WHERE po_id = v_po_6_id LIMIT 1;
  SELECT stock INTO v_snap_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT coalesce(quantity, 0) INTO v_stock_wh_br1
    FROM public.warehouse_stock WHERE company_id = v_co_a AND warehouse_id = v_wh_br1 AND product_id = v_prod_a;
  v_snap_owed_6 := public._supplier_owed(v_co_a, v_sup_a);

  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT public.recibir_orden_compra(
    v_po_6_id, NULL,
    jsonb_build_array(jsonb_build_object('item_id', v_po_6_item, 'received_now', 4)),
    NULL, NULL
  ) IS NOT NULL, 'FALLO BLOQUEANTE 4: primera recepción parcial debe ser exitosa';

  RESET ROLE;

  SELECT status INTO v_after_po_status FROM public.purchase_orders WHERE id = v_po_6_id;
  SELECT received_qty INTO v_after_item_rec FROM public.purchase_order_items WHERE id = v_po_6_item;
  ASSERT v_after_po_status = 'partial' AND v_after_item_rec = 4,
    'FALLO BLOQUEANTE 4: OC debió quedar en partial con received_qty = 4';

  -- Bloqueo estricto de cancelación/transición sobre OC en partial
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'cancelled');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: OC en estado partial NO debe poder cancelarse'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%recepción parcial%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (partial->cancelled): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- Segunda recepción parcial (6 unidades restantes) -> received con acumulación exacta (+10 total, +20000 CxP)
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT public.recibir_orden_compra(
    v_po_6_id, NULL,
    jsonb_build_array(jsonb_build_object('item_id', v_po_6_item, 'received_now', 6)),
    NULL, NULL
  ) IS NOT NULL, 'FALLO BLOQUEANTE 4: segunda recepción parcial debe completar la orden';

  RESET ROLE;

  SELECT status INTO v_after_po_status FROM public.purchase_orders WHERE id = v_po_6_id;
  SELECT received_qty INTO v_after_item_rec FROM public.purchase_order_items WHERE id = v_po_6_item;
  SELECT stock INTO v_after_prod_stock FROM public.products WHERE id = v_prod_a AND company_id = v_co_a;
  SELECT count(*) INTO v_cnt FROM public.warehouse_movements
   WHERE company_id = v_co_a AND reference_type = 'purchase_order' AND reference_id = v_po_6_id;
  ASSERT v_after_po_status = 'received' AND v_after_item_rec = 10
     AND v_after_prod_stock = v_snap_prod_stock + 10
     AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6 + 20000
     AND v_cnt = 2,
    'FALLO BLOQUEANTE 4: recepciones parciales deben acumular inventario (+10), CxP (+20000) y 2 movimientos sin duplicación';

  SELECT coalesce(quantity, 0) INTO v_after_prod_stock
    FROM public.warehouse_stock WHERE company_id = v_co_a AND warehouse_id = v_wh_br1 AND product_id = v_prod_a;
  ASSERT v_after_prod_stock = v_stock_wh_br1 + 10,
    'FALLO BLOQUEANTE 4: warehouse_stock debió acumular exactamente +10 tras las dos recepciones parciales';

  -- 6.11 Orden received no admite más cambios en cambiar_estado_orden_compra
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_6_id, 'cancelled');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 4: orden received NO debe poder cancelarse'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%cerrada o cancelada%' THEN
    RAISE EXCEPTION 'FALLO BLOQUEANTE 4 (received->cancelled): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  -- 6.12–6.14 Bloqueante 5: Privilegios directos DML en acc_* revocados + platform_admin limitado a SELECT en propia empresa
  FOREACH v_tbl IN ARRAY ARRAY[
    'public.acc_accounts',
    'public.acc_entries',
    'public.acc_lines',
    'public.acc_periods',
    'public.acc_closings',
    'public.acc_settings',
    'public.acc_counters'
  ] LOOP
    ASSERT NOT has_table_privilege('authenticated', v_tbl, 'INSERT'),   'FALLO BLOQUEANTE 5: authenticated tiene INSERT en ' || v_tbl;
    ASSERT NOT has_table_privilege('authenticated', v_tbl, 'UPDATE'),   'FALLO BLOQUEANTE 5: authenticated tiene UPDATE en ' || v_tbl;
    ASSERT NOT has_table_privilege('authenticated', v_tbl, 'DELETE'),   'FALLO BLOQUEANTE 5: authenticated tiene DELETE en ' || v_tbl;
    ASSERT NOT has_table_privilege('authenticated', v_tbl, 'TRUNCATE'), 'FALLO BLOQUEANTE 5: authenticated tiene TRUNCATE en ' || v_tbl;
    ASSERT NOT has_table_privilege('anon',          v_tbl, 'SELECT'),   'FALLO BLOQUEANTE 5: anon tiene SELECT en ' || v_tbl;
    ASSERT NOT has_table_privilege('anon',          v_tbl, 'INSERT'),   'FALLO BLOQUEANTE 5: anon tiene INSERT en ' || v_tbl;
  END LOOP;
  ASSERT NOT has_table_privilege('authenticated', 'public.acc_counters', 'SELECT'),
    'FALLO BLOQUEANTE 5: authenticated NO debe tener SELECT directo en acc_counters';

  SELECT count(*) INTO v_cnt
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('acc_accounts', 'acc_entries', 'acc_lines', 'acc_periods', 'acc_closings', 'acc_settings')
     AND policyname = 'platform_admin_company_all';
  ASSERT v_cnt = 0, 'FALLO BLOQUEANTE 5: no debe quedar ninguna política platform_admin_company_all en tablas acc_*';

  PERFORM set_config('request.jwt.claim.sub', v_u_admin_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_admin_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Lectura propia permitida, lectura de Empresa B bloqueada (0 filas)
  SELECT count(*) INTO v_cnt FROM public.acc_accounts WHERE company_id = v_co_a;
  ASSERT v_cnt > 0, 'FALLO BLOQUEANTE 5: platform_admin debe conservar SELECT en acc_accounts de su empresa activa';
  SELECT count(*) INTO v_cnt FROM public.acc_accounts WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO BLOQUEANTE 5: platform_admin de A NO debe leer acc_accounts de Empresa B';
  SELECT count(*) INTO v_cnt FROM public.acc_entries WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO BLOQUEANTE 5: platform_admin de A NO debe leer acc_entries de Empresa B';
  SELECT count(*) INTO v_cnt FROM public.acc_lines WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO BLOQUEANTE 5: platform_admin de A NO debe leer acc_lines de Empresa B';
  SELECT count(*) INTO v_cnt FROM public.acc_settings WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO BLOQUEANTE 5: platform_admin de A NO debe leer acc_settings de Empresa B';

  -- Escritura directa de platform_admin en tablas acc_* rechazada (42501)
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    INSERT INTO public.acc_entries (
      company_id, number, entry_date, description, source_type, status
    ) VALUES (
      v_co_a, 'MAN-INTRUSION-1', current_date, 'Intento inserción directa', 'manual', 'borrador'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5: platform_admin NO debe insertar directamente en acc_entries'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5 (INSERT acc_entries): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    UPDATE public.acc_settings SET active = false WHERE company_id = v_co_a;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5: platform_admin NO debe modificar directamente acc_settings'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5 (UPDATE acc_settings): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    DELETE FROM public.acc_periods WHERE company_id = v_co_a;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5: platform_admin NO debe borrar directamente acc_periods'; END IF;
  IF v_err_state <> '42501' THEN RAISE EXCEPTION 'FALLO BLOQUEANTE 5 (DELETE acc_periods): SQLSTATE inesperado [%] %', v_err_state, v_err_msg; END IF;

  RESET ROLE;

  -- 6.15 Endurecimiento Bloqueante 1 (migración 000068):
  --      Si acc_settings.active = true y start_date IS NULL, NINGUNA ruta puede omitir contabilidad silenciosamente:
  --      registrar_pago_proveedor, acc_post_supplier_payment, cxp_save_account y acc_post_pending deben fallar y revertir.
  --      Se preservan las omisiones legítimas cuando active = false o fecha_pago < start_date.
  v_sup_debt_6 := public._supplier_owed(v_co_a, v_sup_a);
  ASSERT v_sup_debt_6 >= 1000, 'PRECONDICIÓN 6.15: el proveedor debe tener saldo pendiente >= 1000';

  UPDATE public.acc_settings
     SET active = true,
         start_date = NULL
   WHERE company_id = v_co_a;

  SELECT count(*) INTO v_snap_sp_cnt   FROM public.supplier_payments    WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_sa_cnt   FROM public.supplier_allocations WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_cash_cnt FROM public.cash_entries         WHERE company_id = v_co_a;
  SELECT count(*) INTO v_snap_acc_cnt  FROM public.acc_entries          WHERE company_id = v_co_a;
  v_snap_owed_6 := public._supplier_owed(v_co_a, v_sup_a);

  -- 6.15a registrar_pago_proveedor falla y hace rollback completo si active = true y start_date IS NULL
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 200, 'efectivo', 'Activa sin start_date debe fallar', gen_random_uuid());
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 6.15a: registrar_pago_proveedor NO debe completar con contabilidad activa y start_date IS NULL'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%start_date%' THEN
    RAISE EXCEPTION 'FALLO 6.15a (active sin start_date): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT count(*) INTO v_after_sp_cnt   FROM public.supplier_payments    WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_sa_cnt   FROM public.supplier_allocations WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_cash_cnt FROM public.cash_entries         WHERE company_id = v_co_a;
  SELECT count(*) INTO v_after_acc_cnt  FROM public.acc_entries          WHERE company_id = v_co_a;
  ASSERT v_after_sp_cnt = v_snap_sp_cnt AND v_after_sa_cnt = v_snap_sa_cnt
     AND v_after_cash_cnt = v_snap_cash_cnt AND v_after_acc_cnt = v_snap_acc_cnt
     AND public._supplier_owed(v_co_a, v_sup_a) = v_snap_owed_6,
    'FALLO ATOMICIDAD 6.15a: fallo por start_date IS NULL dejó rastro en supplier_payments/allocations/caja/CxP';

  -- 6.15b acc_post_supplier_payment directo también lanza excepción si active = true y start_date IS NULL
  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_supplier_payment(v_pay_id_6);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 6.15b: acc_post_supplier_payment NO debe devolver NULL si active = true y start_date IS NULL'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%start_date%' THEN
    RAISE EXCEPTION 'FALLO 6.15b (acc_post_supplier_payment sin start_date): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  -- 6.15c cxp_save_account y acc_post_pending fallan y revierten cuando active = true y start_date IS NULL
  DELETE FROM public.cxp_settings WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.cxp_save_account(v_acc_cxp_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 6.15c: cxp_save_account NO debe completar si active = true y start_date IS NULL'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%fecha de inicio%' THEN
    RAISE EXCEPTION 'FALLO 6.15c (cxp_save_account sin start_date): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    PERFORM public.acc_post_pending();
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 6.15c: acc_post_pending NO debe completar si active = true y start_date IS NULL'; END IF;
  IF v_err_state <> 'P0001' OR coalesce(v_err_msg, '') NOT ILIKE '%fecha de inicio%' THEN
    RAISE EXCEPTION 'FALLO 6.15c (acc_post_pending sin start_date): error inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RESET ROLE;

  SELECT account_id INTO v_snap_cxp_acc FROM public.cxp_settings WHERE company_id = v_co_a;
  ASSERT v_snap_cxp_acc IS NULL,
    'FALLO ATOMICIDAD 6.15c: cxp_save_account alteró cxp_settings tras fallo por start_date IS NULL';

  -- 6.15d Omisiones legítimas conservadas: active = false (aun con start_date NULL) y payment_date < start_date
  UPDATE public.acc_settings SET active = false, start_date = NULL WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pay_pre_6 := public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'Omisión legítima active=false sin start_date', gen_random_uuid());
  ASSERT v_pay_pre_6 IS NOT NULL, 'FALLO 6.15d: pago con contabilidad inactiva debe permitirse';

  RESET ROLE;

  SELECT count(*) INTO v_after_acc_cnt FROM public.acc_entries
   WHERE company_id = v_co_a AND source_type = 'pago_proveedor' AND source_id = v_pay_pre_6;
  ASSERT v_after_acc_cnt = 0, 'FALLO 6.15d: con active = false no debe generar asiento contable';

  INSERT INTO public.cxp_settings (company_id, account_id)
  VALUES (v_co_a, v_acc_cxp_a)
  ON CONFLICT (company_id) DO UPDATE SET account_id = EXCLUDED.account_id;

  UPDATE public.acc_settings SET active = true, start_date = (current_date + 7) WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_pay_pre_6 := public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'Omisión legítima fecha < start_date', gen_random_uuid());
  ASSERT v_pay_pre_6 IS NOT NULL, 'FALLO 6.15d: pago con fecha < start_date debe permitirse';

  RESET ROLE;

  SELECT count(*) INTO v_after_acc_cnt FROM public.acc_entries
   WHERE company_id = v_co_a AND source_type = 'pago_proveedor' AND source_id = v_pay_pre_6;
  ASSERT v_after_acc_cnt = 0, 'FALLO 6.15d: con fecha < start_date no debe generar asiento contable';

  UPDATE public.acc_settings SET active = true, start_date = (current_date - 30) WHERE company_id = v_co_a;

  -- 6.16 Endurecimiento Bloqueante 3 (migración 000068):
  --      Contador atómico purchase_order_counters cerrado a clientes + numeración monótona por empresa + UNIQUE (company_id, po_number)
  --      NOTA: la concurrencia real multi-sesión debe probarse con sesiones independientes usando supabase/tests/etapa1_po_concurrency_test.sh
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_order_counters', 'SELECT'),
    'FALLO 6.16: authenticated NO debe tener SELECT sobre purchase_order_counters';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_order_counters', 'INSERT'),
    'FALLO 6.16: authenticated NO debe tener INSERT sobre purchase_order_counters';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_order_counters', 'UPDATE'),
    'FALLO 6.16: authenticated NO debe tener UPDATE sobre purchase_order_counters';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_order_counters', 'DELETE'),
    'FALLO 6.16: authenticated NO debe tener DELETE sobre purchase_order_counters';
  ASSERT NOT has_table_privilege('anon', 'public.purchase_order_counters', 'SELECT'),
    'FALLO 6.16: anon NO debe tener SELECT sobre purchase_order_counters';
  ASSERT NOT has_table_privilege('anon', 'public.purchase_order_counters', 'INSERT'),
    'FALLO 6.16: anon NO debe tener INSERT sobre purchase_order_counters';

  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_po_6_seq1_id := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 1, 'unit_cost', 1000)),
    NULL, v_wh_a, 'credito', 30, current_date + 3, 'OC secuencia 1', false
  );
  PERFORM public.cambiar_estado_orden_compra(v_po_6_seq1_id, 'cancelled');

  v_po_6_seq2_id := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 1, 'unit_cost', 1000)),
    NULL, v_wh_a, 'credito', 30, current_date + 3, 'OC secuencia 2 tras cancelación', false
  );

  RESET ROLE;

  SELECT po_number INTO v_po_6_num1 FROM public.purchase_orders WHERE id = v_po_6_seq1_id AND company_id = v_co_a;
  SELECT po_number INTO v_po_6_num2 FROM public.purchase_orders WHERE id = v_po_6_seq2_id AND company_id = v_co_a;
  ASSERT v_po_6_num1 IS NOT NULL AND v_po_6_num2 IS NOT NULL AND v_po_6_num1 <> v_po_6_num2
     AND (regexp_match(v_po_6_num2, '^OC-([0-9]+)$'))[1]::int = (regexp_match(v_po_6_num1, '^OC-([0-9]+)$'))[1]::int + 1,
    format('FALLO 6.16: la numeración de OC debe ser monótona por empresa sin reutilizar/colisionar (%s -> %s)', v_po_6_num1, v_po_6_num2);

  -- Simular contador histórico adelantado (ej. órdenes históricas depuradas/anuladas):
  -- crear_orden_compra NO debe reiniciar ni retroceder al count(*)
  UPDATE public.purchase_order_counters
     SET last_seq = last_seq + 10
   WHERE company_id = v_co_a;

  PERFORM set_config('request.jwt.claim.sub', v_u_compra_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_compra_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_po_6_seq3_id := public.crear_orden_compra(
    v_sup_a,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'ordered_qty', 1, 'unit_cost', 1000)),
    NULL, v_wh_a, 'credito', 30, current_date + 3, 'OC sin reinicio de contador histórico', false
  );

  RESET ROLE;

  SELECT po_number INTO v_po_6_num3 FROM public.purchase_orders WHERE id = v_po_6_seq3_id AND company_id = v_co_a;
  ASSERT (regexp_match(v_po_6_num3, '^OC-([0-9]+)$'))[1]::int = (regexp_match(v_po_6_num2, '^OC-([0-9]+)$'))[1]::int + 11,
    format('FALLO 6.16: el contador no debe reiniciarse a count(*) (%s -> %s)', v_po_6_num2, v_po_6_num3);

  -- Independencia de contador entre Empresa A y Empresa B
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_b::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_dueno_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  v_po_6_b1_id := public.crear_orden_compra(
    v_sup_b,
    jsonb_build_array(jsonb_build_object('product_id', v_prod_b, 'ordered_qty', 1, 'unit_cost', 1000)),
    NULL, v_wh_b, 'credito', 30, current_date + 3, 'OC independiente Empresa B', false
  );

  RESET ROLE;

  SELECT po_number INTO v_po_6_b1_num FROM public.purchase_orders WHERE id = v_po_6_b1_id AND company_id = v_co_b;
  SELECT last_seq INTO v_cnt_b_seq FROM public.purchase_order_counters WHERE company_id = v_co_b;
  ASSERT v_po_6_b1_num = 'OC-0001' AND v_cnt_b_seq = 1,
    format('FALLO 6.16: Empresa B debe iniciar su propio contador independiente en OC-0001 (obtenido %s, seq=%s)', v_po_6_b1_num, v_cnt_b_seq);

  v_unexpected_ok := false; v_err_state := NULL; v_err_msg := NULL;
  BEGIN
    INSERT INTO public.purchase_orders (
      company_id, po_number, status, payment_terms, subtotal, total
    ) VALUES (
      v_co_a, v_po_6_num2, 'draft', 'credito', 0, 0
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE, v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'FALLO 6.16: UNIQUE (company_id, po_number) debe impedir duplicados'; END IF;
  IF v_err_state <> '23505' THEN
    RAISE EXCEPTION 'FALLO 6.16 (duplicado po_number por empresa): SQLSTATE inesperado [%] %', v_err_state, v_err_msg;
  END IF;

  RAISE NOTICE 'ETAPA 1 TEST SUITE OK: todas las aserciones de permisos, separación de funciones, auditoría atómica, CxP, máquina de estados OC, recepciones parciales, numeración atómica OC, atomicidad, acc_*, perfil activo, aislamiento multiempresa y privilegios aprobaron.';
END $$;

ROLLBACK;
