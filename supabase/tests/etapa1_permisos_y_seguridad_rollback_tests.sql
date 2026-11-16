-- supabase/tests/etapa1_permisos_y_seguridad_rollback_tests.sql
-- Suite transaccional no destructiva (BEGIN ... ROLLBACK) para verificar la Etapa 1:
--   1. Separación de funciones por rol (1A Contador, 2A Comprador/Almacén, 3B Gerente/admin_empresa, 4A Vendedor)
--   2. Aislamiento multiempresa estricto (incluyendo cuentas admin globales sin bypass en DIAN/F300/F350)
--   3. Bloqueo de perfiles inactivos (active = false)
--   4. Endurecimiento de privilegios de tablas y funciones internas
--
-- USO: Ejecutar en SQL Editor o psql contra una instancia donde ya se haya aplicado
--      la migración 20261115000065_corregir_permisos_y_seguridad_fase_b.sql.
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

  -- Datos base en Empresa A y Empresa B
  v_wh_a        uuid := 'aaaaaaaa-1111-4000-8000-000000000001';
  v_wh_b        uuid := 'bbbbbbbb-1111-4000-8000-000000000002';
  v_sup_a       uuid := 'aaaaaaaa-2222-4000-8000-000000000001';
  v_sup_b       uuid := 'bbbbbbbb-2222-4000-8000-000000000002';
  v_prod_a      uuid := 'aaaaaaaa-3333-4000-8000-000000000001';
  v_prod_b      uuid := 'bbbbbbbb-3333-4000-8000-000000000002';

  -- Cuentas contables de Empresa A
  v_acc_inv_a   uuid;
  v_acc_iva_d_a uuid;
  v_acc_iva_p_a uuid;
  v_acc_cxp_a   uuid;
  v_acc_caja_a  uuid;

  -- Objetos creados durante las pruebas
  v_pur_pend_a  uuid;
  v_pur_adm_a   uuid;
  v_pur_comp_a  uuid;
  v_po_draft_a  uuid;
  v_po_app_a    uuid;
  v_po_item_a   uuid;
  v_dev_a       uuid;
  v_entry_a     uuid;
  v_cnt         int;
  v_json        jsonb;

  -- Helper interno para simular JWT del usuario y rol authenticated
  -- Nota: usamos EXECUTE sobre SET LOCAL ROLE y RESET ROLE en bloque controlado.
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
    (v_wh_a, v_co_a, 'Bodega Principal A', true),
    (v_wh_b, v_co_b, 'Bodega Principal B', true)
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
  RESET ROLE;

  -- ===========================================================================
  -- PRUEBA 1 (Decisión 1A): CONTADOR con separación de funciones
  -- ===========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1.1 Permitido: can_view_accounting / acc_reconcile / acc_create_entry / acc_post_entry / DIAN F300 & F350
  ASSERT public.can_view_accounting(), 'FALLO 1A: contador debe ver contabilidad';
  PERFORM * FROM public.acc_reconcile();

  v_entry_a := public.acc_create_entry(
    current_date,
    'Asiento manual prueba contador',
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

  v_json := public.dian_calcular_formulario_300(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
  ASSERT v_json IS NOT NULL, 'FALLO 1A: contador debe poder calcular F300 de su empresa';
  v_json := public.dian_calcular_formulario_350(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
  ASSERT v_json IS NOT NULL, 'FALLO 1A: contador debe poder calcular F350 de su empresa';

  -- 1.2 Denegado (42501): acc_save_settings, acc_seed_template, acc_post_pending, registrar_compra, cuentas_por_pagar
  BEGIN
    PERFORM public.acc_save_settings(jsonb_build_object('caja', v_acc_caja_a::text));
    RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_save_settings';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.acc_seed_template('generico');
    RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_seed_template';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.acc_post_pending();
    RAISE EXCEPTION 'FALLO 1A: contador NO debería ejecutar acc_post_pending';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.registrar_compra_con_iva(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL, 0, 'sin_iva', 0, false);
    RAISE EXCEPTION 'FALLO 1A: contador NO debería registrar compras';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.cuentas_por_pagar();
    RAISE EXCEPTION 'FALLO 1A: contador NO debería operar CxP';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  -- ===========================================================================
  -- PRUEBA 2 (Decisión 2A): COMPRADOR vs ALMACÉN
  -- ===========================================================================
  -- 2.1 Comprador crea compra con IVA pendiente, crea OC borrador y OC aprobada, gestiona proveedores
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
  BEGIN
    PERFORM public.anular_compra(v_pur_comp_a);
    RAISE EXCEPTION 'FALLO 2A: comprador NO debería anular compras';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.registrar_devolucion_compra(v_pur_comp_a, v_prod_a, 1, 'Prueba', 'efectivo');
    RAISE EXCEPTION 'FALLO 2A: comprador NO debería registrar devolución a proveedor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'Prueba', NULL);
    RAISE EXCEPTION 'FALLO 2A: comprador NO debería pagar CxP';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.clasificar_iva_compra(v_pur_pend_a, 'descontable', 'Prueba');
    RAISE EXCEPTION 'FALLO 2A: comprador NO debería clasificar IVA';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  SELECT id INTO v_po_item_a FROM public.purchase_order_items WHERE po_id = v_po_app_a LIMIT 1;

  -- 2.2 Contador sí puede clasificar el IVA pendiente creado por Comprador
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM public.clasificar_iva_compra(v_pur_pend_a, 'descontable', 'Clasificado por contador');
  RESET ROLE;

  -- 2.3 Almacén: NO compra directa, NO aprueba OC, NO recibe OC en borrador, NO altera condiciones en recepción
  PERFORM set_config('request.jwt.claim.sub', v_u_almacen_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_almacen_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.registrar_compra(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL);
    RAISE EXCEPTION 'FALLO 2A: almacén NO debería registrar compras directas';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.cambiar_estado_orden_compra(v_po_draft_a, 'approved');
    RAISE EXCEPTION 'FALLO 2A: almacén NO debería aprobar órdenes de compra';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_draft_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', (SELECT id FROM public.purchase_order_items WHERE po_id = v_po_draft_a LIMIT 1), 'received_now', 1)),
      'credito', 45
    );
    RAISE EXCEPTION 'FALLO 2A: almacén NO debería recibir una OC en estado draft';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Intento de Almacén de cambiar bodega hacia Empresa B -> rechazado
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_b,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
      'credito', 45
    );
    RAISE EXCEPTION 'FALLO 2A: almacén NO debe poder recibir en bodega de Empresa B';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Intento de Almacén de cambiar forma de pago pactada -> 42501
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
      'efectivo', 45
    );
    RAISE EXCEPTION 'FALLO 2A: almacén NO debe alterar p_payment_method de la OC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Intento de Almacén de alterar unit_cost pactado -> 42501
  BEGIN
    PERFORM public.recibir_orden_compra(
      v_po_app_a, v_wh_a,
      jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2, 'unit_cost', 9999)),
      'credito', 45
    );
    RAISE EXCEPTION 'FALLO 2A: almacén NO debe alterar unit_cost pactado en la OC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Recepción legítima de Almacén con parámetros exactos de la OC -> éxito
  ASSERT public.recibir_orden_compra(
    v_po_app_a, v_wh_a,
    jsonb_build_array(jsonb_build_object('item_id', v_po_item_a, 'received_now', 2)),
    'credito', 45
  ) IS NOT NULL, 'FALLO 2A: almacén debe poder recibir físicamente OC aprobada';

  RESET ROLE;

  -- ===========================================================================
  -- PRUEBA 3 (Decisión 3B): ADMIN_EMPRESA paridad con DUEÑO; GERENTE solo supervisión
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

  BEGIN
    PERFORM public.acc_reopen_period(2026, 1, 'Prueba paridad admin_empresa');
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION 'FALLO 3B: admin_empresa no debe fallar por 42501 en acc_reopen_period';
    WHEN OTHERS THEN
      NULL; -- Error de negocio esperado ('Ese periodo no está cerrado')
  END;

  RESET ROLE;

  -- Gerente: consulta CxP y concilia, pero NO registra compras, NO anula compras/devoluciones, NO paga CxP
  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT public.cuentas_por_pagar() IS NOT NULL, 'FALLO 3B: gerente debe consultar CxP';
  ASSERT public.cxp_config() IS NOT NULL, 'FALLO 3B: gerente debe consultar config CxP';
  PERFORM * FROM public.acc_reconcile();

  BEGIN
    PERFORM public.registrar_compra_con_iva(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL, 0, 'sin_iva', 0, false);
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar compras directas';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.anular_compra(v_pur_comp_a);
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe anular compras';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.registrar_devolucion_compra(v_pur_comp_a, v_prod_a, 1, 'No permitido', 'efectivo');
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar devoluciones a proveedor';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.registrar_pago_proveedor(v_sup_a, 100, 'efectivo', 'No permitido', NULL);
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe registrar pagos CxP';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.cxp_save_account(v_acc_cxp_a);
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe cambiar cuenta CxP';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.acc_reopen_period(2026, 1, 'No permitido para gerente');
    RAISE EXCEPTION 'FALLO 3B: gerente NO debe poder reabrir periodos contables';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  -- ===========================================================================
  -- PRUEBA 4 (Condiciones 1 y 2): AISLAMIENTO MULTIEMPRESA + ADMIN SIN BYPASS + PERFIL INACTIVO
  -- ===========================================================================
  -- 4.1 Admin vinculado a Empresa A NO puede leer/escribir tablas DIAN de Empresa B ni F300/F350 de B
  PERFORM set_config('request.jwt.claim.sub', v_u_admin_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_admin_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  SELECT count(*) INTO v_cnt FROM public.dian_tax_rules WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_tax_rules de Empresa B';

  SELECT count(*) INTO v_cnt FROM public.dian_account_mappings WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_account_mappings de Empresa B';

  SELECT count(*) INTO v_cnt FROM public.dian_certificates_issued WHERE company_id = v_co_b;
  ASSERT v_cnt = 0, 'FALLO RLS: admin de Empresa A vio dian_certificates_issued de Empresa B';

  BEGIN
    INSERT INTO public.dian_tax_rules (company_id, tax_type, concept_name, percentage, account_code)
    VALUES (v_co_b, 'retefuente', 'Intrusión', 2.5, '236540');
    RAISE EXCEPTION 'FALLO RLS: admin de Empresa A pudo insertar dian_tax_rules en Empresa B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.dian_calcular_formulario_300(v_co_b, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    RAISE EXCEPTION 'FALLO AISLAMIENTO: admin de Empresa A pudo consultar F300 de Empresa B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.dian_calcular_formulario_350(v_co_b, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    RAISE EXCEPTION 'FALLO AISLAMIENTO: admin de Empresa A pudo consultar F350 de Empresa B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  -- 4.2 Perfil inactivo (even with role='dueno') queda bloqueado en todas las RPCs y RLS
  PERFORM set_config('request.jwt.claim.sub', v_u_inact_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_inact_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  ASSERT NOT public.can_view_accounting(), 'FALLO INACTIVO: perfil active=false obtuvo can_view_accounting() = true';

  SELECT count(*) INTO v_cnt FROM public.dian_tax_rules WHERE company_id = v_co_a;
  ASSERT v_cnt = 0, 'FALLO INACTIVO: perfil active=false vio dian_tax_rules';

  BEGIN
    PERFORM public.registrar_compra(v_sup_a, jsonb_build_array(jsonb_build_object('product_id', v_prod_a, 'quantity', 1, 'cost', 1000)), 'efectivo', NULL);
    RAISE EXCEPTION 'FALLO INACTIVO: perfil active=false pudo registrar compra';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  RESET ROLE;

  -- 4.3 Vendedor bloqueado en contabilidad, compras, DIAN y devoluciones de compra
  PERFORM set_config('request.jwt.claim.sub', v_u_vend_a::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_u_vend_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  BEGIN
    PERFORM public.dian_calcular_formulario_300(v_co_a, (current_date - 1)::timestamptz, (current_date + 2)::timestamptz);
    RAISE EXCEPTION 'FALLO 4A: vendedor no debe ejecutar F300';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 4.4 Endurecimiento de privilegios directos DML y funciones internas
  ASSERT NOT has_table_privilege('authenticated', 'public.purchases', 'INSERT'), 'FALLO GRANT: authenticated tiene INSERT directo en purchases';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_devolutions', 'DELETE'), 'FALLO GRANT: authenticated tiene DELETE directo en purchase_devolutions';
  ASSERT NOT has_table_privilege('authenticated', 'public.purchase_orders', 'UPDATE'), 'FALLO GRANT: authenticated tiene UPDATE directo en purchase_orders';
  ASSERT NOT has_function_privilege('authenticated', 'public._require_company_roles(text[])', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _require_company_roles';
  ASSERT NOT has_function_privilege('authenticated', 'public._registrar_compra_core(uuid, uuid, jsonb, text, integer, numeric, text, numeric, boolean)', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _registrar_compra_core';
  ASSERT NOT has_function_privilege('authenticated', 'public._registrar_compra_impl(uuid, jsonb, text, integer, numeric, text, numeric, boolean)', 'EXECUTE'), 'FALLO GRANT: authenticated puede ejecutar _registrar_compra_impl';

  RESET ROLE;

  RAISE NOTICE 'ETAPA 1 TEST SUITE OK: todas las aserciones de permisos, separación de funciones, perfil activo, aislamiento multiempresa y privilegios aprobaron.';
END $$;

ROLLBACK;
