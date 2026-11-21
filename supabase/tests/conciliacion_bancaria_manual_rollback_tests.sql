-- ============================================================================
-- SUITE DE PRUEBAS TRANSACCIONALES NO DESTRUCTIVAS (BEGIN ... ROLLBACK)
-- Módulo: Conciliación Bancaria Manual (Migración 20261119000069)
--
-- Ejecución real de roles PostgreSQL:
--   - Preparación de fixtures bajo rol propietario/ejecutor (RESET ROLE).
--   - Conmutación explícita a roles reales de base de datos:
--       SET LOCAL ROLE authenticated;
--       SET LOCAL ROLE anon;
--     junto con claims JWT por usuario, validando GRANT/REVOKE, RLS, triggers,
--     constraints compuestos y RPCs SECURITY DEFINER en escenarios reales.
--
-- Cobertura de las 12 pruebas obligatorias:
--   1. Aislamiento entre dos empresas (RLS, RPCs, FKs compuestas y triggers)
--   2. Usuarios con diferentes roles (dueno, admin_empresa, gerente, contador,
--      vendedor, inactivo, tecnico con y sin autorización de soporte)
--   3. Administrador de plataforma (admin / super_admin) sin acceso cruzado
--   4. Cruces parciales y múltiples N-a-M + inmutabilidad de acc_entries/acc_lines
--   5. Signos, naturaleza contable (debito y credito) e independencia de orden
--   6. Sobreasignación de importes, IDs duplicados y asientos posteriores al corte
--   7. Extractos confirmados (incluyendo parcialmente_conciliado), doble
--      confirmación bloqueada y reapertura formal autorizada
--   8. Anulaciones (cruce, renglón, extracto) y diferencias explícitas
--   9. Fechas válidas del extracto y respeto a periodos contables cerrados
--  10. Atomicidad ante errores (lotes de renglones y cruces fallidos)
--  11. Protección de inmutabilidad en auditoría (bank_reconciliation_events)
--  12. Intentos de acceso directo (anon/authenticated sobre tablas, counters y RPCs)
-- ============================================================================

BEGIN;

DO $$
DECLARE
  -- Empresas
  v_co_a uuid := 'aaaaaaaa-0000-4000-8000-0000000000a1';
  v_co_b uuid := 'bbbbbbbb-0000-4000-8000-0000000000b1';

  -- Usuarios Empresa A + Soporte + Empresa B
  v_u_admin_a   uuid := '11111111-0000-4000-8000-0000000000a1';
  v_u_super_a   uuid := '11111111-0000-4000-8000-0000000000a0';
  v_u_dueno_a   uuid := '11111111-0000-4000-8000-0000000000a2';
  v_u_adm_emp_a uuid := '11111111-0000-4000-8000-0000000000a9';
  v_u_gerente_a uuid := '11111111-0000-4000-8000-0000000000a3';
  v_u_conta_a   uuid := '11111111-0000-4000-8000-0000000000a4';
  v_u_vend_a    uuid := '11111111-0000-4000-8000-0000000000a5';
  v_u_inact_a   uuid := '11111111-0000-4000-8000-0000000000a6';
  v_u_tech_a    uuid := '11111111-0000-4000-8000-0000000000a7';
  v_u_dueno_b   uuid := '22222222-0000-4000-8000-0000000000b1';
  v_u_plat      uuid;

  -- Cuentas PUC
  v_acc_bank_a    uuid;
  v_acc_income_a  uuid;
  v_acc_expense_a uuid;
  v_acc_header_a  uuid;
  v_acc_credit_a  uuid;
  v_acc_bank_b    uuid;

  -- Asientos y renglones contables
  v_entry_1       uuid;
  v_entry_2       uuid;
  v_entry_3_out   uuid;
  v_entry_4_fut   uuid;
  v_entry_5_crpuc uuid;
  v_entry_b       uuid;

  v_acc_line_in_1   uuid; -- Debito 600 en banco A (ingreso)
  v_acc_line_in_2   uuid; -- Debito 400 en banco A (ingreso)
  v_acc_line_out_1  uuid; -- Credito 150 en banco A (egreso)
  v_acc_line_fut    uuid; -- Asiento posterior al cutoff
  v_acc_line_crpuc  uuid; -- Credito 200 en cuenta activo naturaleza credito
  v_acc_line_b      uuid; -- Linea contable empresa B

  -- Objetos bancarios
  v_bank_acc_a     uuid;
  v_bank_acc_cr_a  uuid;
  v_bank_acc_b     uuid;
  v_stmt_a         uuid;
  v_stmt_lock      uuid;
  v_stmt_b         uuid;
  v_stmt_cr        uuid;

  v_stmt_line_cr   uuid; -- Credito 1000
  v_stmt_line_db   uuid; -- Debito 150
  v_stmt_line_extra uuid; -- Debito 100 diferencia
  v_lock_line_1    uuid;
  v_lock_line_2    uuid;
  v_cr_line        uuid;

  v_match_1        uuid;
  v_match_lock     uuid;
  v_match_id       uuid;
  v_ticket_id      uuid;

  -- Auxiliares verificación
  v_masked             text;
  v_code_1             text;
  v_code_2             text;
  v_status             text;
  v_summary            jsonb;
  v_summary_b          jsonb;
  v_pairs_fwd          jsonb;
  v_pairs_rev          jsonb;
  v_cnt                int;
  v_lines_before       int;
  v_lines_after        int;
  v_acc_entries_before int;
  v_acc_lines_before   int;
  v_acc_entries_after  int;
  v_acc_lines_after    int;
  v_event_id           uuid;

  v_unexpected_ok boolean;
  v_err_state     text;
  v_err_msg       text;
BEGIN
  -- =========================================================================
  -- 0. PREPARACIÓN DE FIXTURES MULTIEMPRESA (ROL PROPIETARIO)
  -- =========================================================================
  RESET ROLE;

  INSERT INTO public.companies (id, name, active)
  VALUES
    (v_co_a, 'Banco Test Empresa A', true),
    (v_co_b, 'Banco Test Empresa B', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data
  )
  VALUES
    (v_u_super_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_super_a@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_admin_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_admin_a@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_dueno_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_dueno_a@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_adm_emp_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_admemp_a@test.local',  '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_gerente_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_gerente_a@test.local', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_conta_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_conta_a@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_vend_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_vend_a@test.local',    '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_inact_a,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_inact_a@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_tech_a,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_tech_a@test.local',    '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
    (v_u_dueno_b,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bk_dueno_b@test.local',   '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, email, full_name, role, company_id, active)
  VALUES
    (v_u_super_a,   'bk_super_a@test.local',   'Super Admin Test A',  'super_admin',   v_co_a, true),
    (v_u_admin_a,   'bk_admin_a@test.local',   'Admin Test A',        'admin',         v_co_a, true),
    (v_u_dueno_a,   'bk_dueno_a@test.local',   'Dueno Test A',        'dueno',         v_co_a, true),
    (v_u_adm_emp_a, 'bk_admemp_a@test.local',  'Admin Empresa A',     'admin_empresa', v_co_a, true),
    (v_u_gerente_a, 'bk_gerente_a@test.local', 'Gerente Test A',      'gerente',       v_co_a, true),
    (v_u_conta_a,   'bk_conta_a@test.local',   'Contador Test A',     'contador',      v_co_a, true),
    (v_u_vend_a,    'bk_vend_a@test.local',    'Vendedor Test A',     'vendedor',      v_co_a, true),
    (v_u_inact_a,   'bk_inact_a@test.local',   'Inactivo Test A',     'dueno',         v_co_a, false),
    (v_u_tech_a,    'bk_tech_a@test.local',    'Tecnico Test A',      'tecnico',       v_co_a, true),
    (v_u_dueno_b,   'bk_dueno_b@test.local',   'Dueno Test B',        'dueno',         v_co_b, true)
  ON CONFLICT (id) DO UPDATE SET
    role = excluded.role,
    company_id = excluded.company_id,
    active = excluded.active;

  -- Asegurar periodos contables abiertos en Nov 2026 para Empresa A y Empresa B
  INSERT INTO public.acc_periods (company_id, year, month, status)
  VALUES
    (v_co_a, 2026, 11, 'abierto'),
    (v_co_b, 2026, 11, 'abierto')
  ON CONFLICT (company_id, year, month) DO UPDATE SET status = 'abierto';

  -- Cuentas PUC (incluye cuenta activo naturaleza credito para probar ambos signos)
  INSERT INTO public.acc_accounts (company_id, code, name, type, nature, is_postable, active)
  VALUES
    (v_co_a, '11',     'Disponible',          'activo',  'debito',  false, true),
    (v_co_a, '111005', 'Bancolombia Test A',  'activo',  'debito',  true,  true),
    (v_co_a, '111099', 'Cupo Credito Activo', 'activo',  'credito', true,  true),
    (v_co_a, '413505', 'Ingresos Op A',       'ingreso', 'credito', true,  true),
    (v_co_a, '510595', 'Gastos Bancarios A',  'gasto',   'debito',  true,  true),
    (v_co_b, '111005', 'Banco Emp B',         'activo',  'debito',  true,  true),
    (v_co_b, '413505', 'Ingresos Op B',       'ingreso', 'credito', true,  true)
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_acc_header_a  FROM public.acc_accounts WHERE company_id = v_co_a AND code = '11'     LIMIT 1;
  SELECT id INTO v_acc_bank_a    FROM public.acc_accounts WHERE company_id = v_co_a AND code = '111005' LIMIT 1;
  SELECT id INTO v_acc_credit_a  FROM public.acc_accounts WHERE company_id = v_co_a AND code = '111099' LIMIT 1;
  SELECT id INTO v_acc_income_a  FROM public.acc_accounts WHERE company_id = v_co_a AND code = '413505' LIMIT 1;
  SELECT id INTO v_acc_expense_a FROM public.acc_accounts WHERE company_id = v_co_a AND code = '510595' LIMIT 1;
  SELECT id INTO v_acc_bank_b    FROM public.acc_accounts WHERE company_id = v_co_b AND code = '111005' LIMIT 1;

  -- Asientos contabilizados en Empresa A:
  --  1) Debito 600 en 111005 (ingreso en extracto)
  --  2) Debito 400 en 111005 (ingreso en extracto)
  --  3) Credito 150 en 111005 (egreso en extracto)
  --  4) Debito 250 en 111005 con fecha posterior al corte (2026-12-02)
  --  5) Credito 200 en 111099 (cuenta activo naturaleza credito => ingreso bancario)
  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_a, 'TST-BK-001', '2026-11-05', 'Cobro cliente parcial 1', 'contabilizado', 'manual', v_u_dueno_a)
  RETURNING id INTO v_entry_1;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_a, v_entry_1, v_acc_bank_a,   600.00, 0, 'Consignación 1'),
    (v_co_a, v_entry_1, v_acc_income_a, 0, 600.00, 'Ingreso 1');
  SELECT id INTO v_acc_line_in_1 FROM public.acc_lines WHERE entry_id = v_entry_1 AND account_id = v_acc_bank_a LIMIT 1;

  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_a, 'TST-BK-002', '2026-11-06', 'Cobro cliente parcial 2', 'contabilizado', 'manual', v_u_dueno_a)
  RETURNING id INTO v_entry_2;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_a, v_entry_2, v_acc_bank_a,   400.00, 0, 'Consignación 2'),
    (v_co_a, v_entry_2, v_acc_income_a, 0, 400.00, 'Ingreso 2');
  SELECT id INTO v_acc_line_in_2 FROM public.acc_lines WHERE entry_id = v_entry_2 AND account_id = v_acc_bank_a LIMIT 1;

  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_a, 'TST-BK-003', '2026-11-08', 'Pago proveedor transferencia', 'contabilizado', 'manual', v_u_dueno_a)
  RETURNING id INTO v_entry_3_out;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_a, v_entry_3_out, v_acc_expense_a, 150.00, 0, 'Gasto servicio'),
    (v_co_a, v_entry_3_out, v_acc_bank_a,    0, 150.00, 'Salida banco');
  SELECT id INTO v_acc_line_out_1 FROM public.acc_lines WHERE entry_id = v_entry_3_out AND account_id = v_acc_bank_a LIMIT 1;

  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_a, 'TST-BK-FUT', '2026-12-02', 'Asiento futuro post corte', 'contabilizado', 'manual', v_u_dueno_a)
  RETURNING id INTO v_entry_4_fut;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_a, v_entry_4_fut, v_acc_bank_a,   250.00, 0, 'Consignación diciembre'),
    (v_co_a, v_entry_4_fut, v_acc_income_a, 0, 250.00, 'Ingreso diciembre');
  SELECT id INTO v_acc_line_fut FROM public.acc_lines WHERE entry_id = v_entry_4_fut AND account_id = v_acc_bank_a LIMIT 1;

  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_a, 'TST-BK-CRP', '2026-11-09', 'Movimiento cuenta naturaleza credito', 'contabilizado', 'manual', v_u_dueno_a)
  RETURNING id INTO v_entry_5_crpuc;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_a, v_entry_5_crpuc, v_acc_expense_a, 200.00, 0, 'Cargo'),
    (v_co_a, v_entry_5_crpuc, v_acc_credit_a,  0, 200.00, 'Abono natural credito');
  SELECT id INTO v_acc_line_crpuc FROM public.acc_lines WHERE entry_id = v_entry_5_crpuc AND account_id = v_acc_credit_a LIMIT 1;

  -- Asiento contabilizado en Empresa B (para verificar aislamiento resumen y cruces)
  INSERT INTO public.acc_entries (company_id, number, entry_date, description, status, source_type, created_by)
  VALUES (v_co_b, 'TST-B-001', '2026-11-05', 'Cobro Empresa B', 'contabilizado', 'manual', v_u_dueno_b)
  RETURNING id INTO v_entry_b;
  INSERT INTO public.acc_lines (company_id, entry_id, account_id, debit, credit, memo)
  VALUES
    (v_co_b, v_entry_b, v_acc_bank_b, 9999.00, 0, 'Consignación Emp B'),
    (v_co_b, v_entry_b, (SELECT id FROM public.acc_accounts WHERE company_id = v_co_b AND code = '413505' LIMIT 1), 0, 9999.00, 'Ingreso Emp B');
  SELECT id INTO v_acc_line_b FROM public.acc_lines WHERE entry_id = v_entry_b AND account_id = v_acc_bank_b LIMIT 1;

  SELECT count(*) INTO v_acc_entries_before FROM public.acc_entries WHERE company_id = v_co_a;
  SELECT count(*) INTO v_acc_lines_before   FROM public.acc_lines   WHERE company_id = v_co_a;

  -- =========================================================================
  -- PRUEBA 12A: ACCESO ANON BLOQUEADO EN TABLAS Y RPCS (SET LOCAL ROLE anon)
  -- =========================================================================
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);

  v_unexpected_ok := false;
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.bank_accounts;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 12A.1: anon pudo consultar bank_accounts (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.can_access_bank_reconciliation();
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 12A.2: anon pudo invocar can_access_bank_reconciliation (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_upsert_account(null, 'Banco', 'Anon', 'ahorros', '1234', v_acc_bank_a, 'COP', null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 12A.3: anon pudo invocar bank_upsert_account (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- =========================================================================
  -- PRUEBA 2A: VENDEDOR, INACTIVO Y TÉCNICO SIN AUTORIZACIÓN BLOQUEADOS (ROLE authenticated)
  -- =========================================================================
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Vendedor
  PERFORM set_config('request.jwt.claim.sub', v_u_vend_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_vend_a::text, 'role', 'authenticated')::text, true);
  IF public.can_access_bank_reconciliation() THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2A.1: vendedor obtuvo can_access_bank_reconciliation = true';
  END IF;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_upsert_account(null, 'Bancolombia', 'Vend', 'ahorros', '1234', v_acc_bank_a, 'COP', null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2A.2: vendedor no bloqueado (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- Perfil inactivo (role=dueno, active=false)
  PERFORM set_config('request.jwt.claim.sub', v_u_inact_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_inact_a::text, 'role', 'authenticated')::text, true);
  IF public.can_access_bank_reconciliation() THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2A.3: usuario inactivo obtuvo acceso';
  END IF;
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_upsert_account(null, 'Bancolombia', 'Inact', 'ahorros', '1234', v_acc_bank_a, 'COP', null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2A.4: inactivo no bloqueado (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- Contador NO puede administrar cuentas bancarias
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  IF NOT public.can_access_bank_reconciliation() THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2B.1: contador debe tener acceso de lectura al módulo';
  END IF;
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_upsert_account(null, 'Bancolombia', 'Intento Conta', 'ahorros', '1234', v_acc_bank_a, 'COP', null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2B.2: contador administró cuentas bancarias (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- =========================================================================
  -- PRUEBA 12B: BLOQUEO DE SELECT EN bank_statement_counters Y DML DIRECTO
  -- =========================================================================
  v_unexpected_ok := false;
  BEGIN
    SELECT count(*) INTO v_cnt FROM public.bank_statement_counters;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 12B.1: authenticated pudo leer bank_statement_counters (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- =========================================================================
  -- CREACIÓN DE CUENTAS BANCARIAS (DUEÑO A Y GERENTE A + DUEÑO B)
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);

  -- Rechazo PUC no imputable
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_upsert_account(null, 'Bancolombia', 'Mala PUC', 'ahorros', '99991234', v_acc_header_a, 'COP', null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'Fallo PUC no imputable permitido';
  END IF;

  v_bank_acc_a := public.bank_upsert_account(
    null, 'Bancolombia', 'Cuenta Recaudo A', 'ahorros', '001928374651234', v_acc_bank_a, 'COP', 'Cuenta test A'
  );
  SELECT account_number_masked INTO v_masked FROM public.bank_accounts WHERE id = v_bank_acc_a;
  IF v_masked <> '****1234' THEN
    RAISE EXCEPTION 'Fallo enmascaramiento: %', v_masked;
  END IF;

  -- DML directo bloqueado incluso para dueño (solo lectura por RLS + RPC)
  v_unexpected_ok := false;
  BEGIN
    UPDATE public.bank_accounts SET bank_name = 'Bypass' WHERE id = v_bank_acc_a;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 12B.2: authenticated ejecutó UPDATE directo sobre bank_accounts (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  v_bank_acc_cr_a := public.bank_upsert_account(
    null, 'Davivienda', 'Cupo Credito Activo', 'corriente', '009988775678', v_acc_credit_a, 'COP', 'Cuenta naturaleza credito'
  );

  -- Crear cuenta en Empresa B
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_b::text, 'role', 'authenticated')::text, true);
  v_bank_acc_b := public.bank_upsert_account(
    null, 'Banco Occidente', 'Cuenta Emp B', 'ahorros', '554433229876', v_acc_bank_b, 'COP', null
  );
  v_stmt_b := public.bank_create_statement(
    v_bank_acc_b, '2026-11-01', '2026-11-30', '2026-11-30', 100.00, 100.00, 'Extracto B'
  );

  -- =========================================================================
  -- PRUEBA 9A: FECHAS INVÁLIDAS DE EXTRACTO Y CÓDIGOS ÚNICOS
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);

  -- cutoff_date fuera de period_start..period_end
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_statement(v_bank_acc_a, '2026-11-01', '2026-11-25', '2026-11-30', 0, null, null);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%dentro del período%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 9A: permitió cutoff fuera de período (% / %)', v_unexpected_ok, v_err_msg;
  END IF;

  -- Crear dos extractos en Empresa A y verificar códigos secuenciales vía bank_statement_counters
  v_stmt_a := public.bank_create_statement(
    v_bank_acc_a, '2026-11-01', '2026-11-30', '2026-11-30', 500.00, 1450.00, 'Extracto Principal Nov'
  );
  v_stmt_lock := public.bank_create_statement(
    v_bank_acc_a, '2026-11-01', '2026-11-30', '2026-11-30', 0.00, 300.00, 'Extracto Prueba Lock'
  );
  SELECT statement_code INTO v_code_1 FROM public.bank_statements WHERE id = v_stmt_a;
  SELECT statement_code INTO v_code_2 FROM public.bank_statements WHERE id = v_stmt_lock;
  IF v_code_1 = v_code_2 OR v_code_1 NOT LIKE 'EXT-202611-%' OR v_code_2 NOT LIKE 'EXT-202611-%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 9B: códigos de extracto inválidos o colisionados (% vs %)', v_code_1, v_code_2;
  END IF;

  -- =========================================================================
  -- PRUEBA 10A: ATOMICIDAD EN CARGA DE RENGLONES POR LOTE
  -- =========================================================================
  SELECT count(*) INTO v_lines_before FROM public.bank_statement_lines WHERE statement_id = v_stmt_a;
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_add_statement_lines(
      v_stmt_a,
      jsonb_build_array(
        jsonb_build_object('tx_date', '2026-11-05', 'description', 'Movimiento bueno 1', 'direction', 'credit', 'amount', 100.00),
        jsonb_build_object('tx_date', '2026-12-05', 'description', 'Movimiento fuera de rango', 'direction', 'credit', 'amount', 200.00)
      ),
      'manual'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_lines_after FROM public.bank_statement_lines WHERE statement_id = v_stmt_a;
  IF v_unexpected_ok OR v_lines_before <> v_lines_after THEN
    RAISE EXCEPTION 'Fallo PRUEBA 10A: lote fallido dejó renglones parciales (% -> %)', v_lines_before, v_lines_after;
  END IF;

  -- Carga con post_date > cutoff_date también falla atómicamente
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_add_statement_lines(
      v_stmt_a,
      jsonb_build_array(
        jsonb_build_object('tx_date', '2026-11-05', 'post_date', '2026-12-01', 'description', 'Post date mayor al corte', 'direction', 'credit', 'amount', 50.00)
      ),
      'manual'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%corte%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 9C: permitió post_date > cutoff_date (% / %)', v_unexpected_ok, v_err_msg;
  END IF;

  -- Agregar movimientos válidos en v_stmt_a: +1000 crédito, -150 débito, -100 débito (comisión para diferencia)
  SELECT public.bank_add_statement_lines(
    v_stmt_a,
    jsonb_build_array(
      jsonb_build_object('tx_date', '2026-11-05', 'description', 'Abono cliente agrupado', 'bank_reference', 'REF-100', 'direction', 'credit', 'amount', 1000.00),
      jsonb_build_object('tx_date', '2026-11-08', 'description', 'Transferencia proveedor', 'bank_reference', 'TRF-150', 'direction', 'debit', 'amount', 150.00),
      jsonb_build_object('tx_date', '2026-11-12', 'description', 'Comisión no registrada', 'bank_reference', 'COM-100', 'direction', 'debit', 'amount', 100.00)
    ),
    'manual'
  ) INTO v_cnt;
  IF v_cnt <> 3 THEN
    RAISE EXCEPTION 'Se esperaban 3 renglones, insertados %', v_cnt;
  END IF;

  SELECT id INTO v_stmt_line_cr    FROM public.bank_statement_lines WHERE statement_id = v_stmt_a AND direction = 'credit' LIMIT 1;
  SELECT id INTO v_stmt_line_db    FROM public.bank_statement_lines WHERE statement_id = v_stmt_a AND direction = 'debit' AND amount = 150.00 LIMIT 1;
  SELECT id INTO v_stmt_line_extra FROM public.bank_statement_lines WHERE statement_id = v_stmt_a AND direction = 'debit' AND amount = 100.00 LIMIT 1;

  -- =========================================================================
  -- PRUEBA 5: SIGNOS, NATURALEZA E INDEPENDENCIA DEL ORDEN DE IDENTIFICADORES
  -- =========================================================================
  -- 5A. Rechazar cruce cruzado de naturaleza (crédito bancario contra egreso contable)
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 150.00)),
      jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_out_1, 'amount', 150.00)),
      'Cruce naturaleza invertida'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%Descuadre%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 5A: permitió cruzar crédito bancario con egreso contable (% / %)', v_unexpected_ok, v_err_msg;
  END IF;

  -- 5B. Verificar independencia del orden al mezclar ingreso + egreso en un mismo grupo N-a-M
  --     Usamos SAVEPOINT mediante bloques BEGIN..EXCEPTION dentro del DO: primero en orden directo,
  --     capturamos parejas exactas, abortamos subtransacción con excepción controlada, luego en orden inverso,
  --     abortamos de nuevo y comparamos ambas estructuras JSONB: deben ser IDÉNTICAS.
  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(
        jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 1000.00),
        jsonb_build_object('statement_line_id', v_stmt_line_db, 'amount', 150.00)
      ),
      jsonb_build_array(
        jsonb_build_object('acc_line_id', v_acc_line_in_1,  'amount', 600.00),
        jsonb_build_object('acc_line_id', v_acc_line_in_2,  'amount', 400.00),
        jsonb_build_object('acc_line_id', v_acc_line_out_1, 'amount', 150.00)
      ),
      'Orden directo'
    );
    SELECT jsonb_agg(jsonb_build_object('sl', statement_line_id, 'al', acc_line_id, 'amt', matched_amount) order by statement_line_id, acc_line_id)
      INTO v_pairs_fwd
      FROM public.bank_reconciliation_matches
     WHERE statement_id = v_stmt_a AND status = 'activo';
    RAISE EXCEPTION '__ROLLBACK_SUBTEST__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK_SUBTEST__' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(
        jsonb_build_object('statement_line_id', v_stmt_line_db, 'amount', 150.00),
        jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 1000.00)
      ),
      jsonb_build_array(
        jsonb_build_object('acc_line_id', v_acc_line_out_1, 'amount', 150.00),
        jsonb_build_object('acc_line_id', v_acc_line_in_2,  'amount', 400.00),
        jsonb_build_object('acc_line_id', v_acc_line_in_1,  'amount', 600.00)
      ),
      'Orden invertido'
    );
    SELECT jsonb_agg(jsonb_build_object('sl', statement_line_id, 'al', acc_line_id, 'amt', matched_amount) order by statement_line_id, acc_line_id)
      INTO v_pairs_rev
      FROM public.bank_reconciliation_matches
     WHERE statement_id = v_stmt_a AND status = 'activo';
    RAISE EXCEPTION '__ROLLBACK_SUBTEST__';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> '__ROLLBACK_SUBTEST__' THEN RAISE; END IF;
  END;

  IF v_pairs_fwd IS NULL OR v_pairs_fwd IS DISTINCT FROM v_pairs_rev THEN
    RAISE EXCEPTION 'Fallo PRUEBA 5B: el resultado dependió del orden de IDs (% vs %)', v_pairs_fwd, v_pairs_rev;
  END IF;

  -- 5C. Probar cuenta PUC de naturaleza 'credito' (v_acc_credit_a): crédito contable = ingreso bancario ('credit')
  v_stmt_cr := public.bank_create_statement(
    v_bank_acc_cr_a, '2026-11-01', '2026-11-30', '2026-11-30', 0, 200.00, 'Test naturaleza credito'
  );
  PERFORM public.bank_add_statement_lines(
    v_stmt_cr,
    jsonb_build_array(jsonb_build_object('tx_date', '2026-11-09', 'description', 'Abono cupo', 'direction', 'credit', 'amount', 200.00)),
    'manual'
  );
  SELECT id INTO v_cr_line FROM public.bank_statement_lines WHERE statement_id = v_stmt_cr LIMIT 1;
  PERFORM public.bank_create_manual_match(
    v_stmt_cr,
    jsonb_build_array(jsonb_build_object('statement_line_id', v_cr_line, 'amount', 200.00)),
    jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_crpuc, 'amount', 200.00)),
    'Cruce cuenta naturaleza credito'
  );

  -- =========================================================================
  -- PRUEBA 4 & 6: CRUCES PARCIALES/N:M, SOBREASIGNACIÓN, DUPLICADOS Y ASIENTO FUTURO
  -- =========================================================================
  -- 4A. Primer cruce parcial ($600 de $1000)
  v_match_1 := public.bank_create_manual_match(
    v_stmt_a,
    jsonb_build_array(jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 600.00)),
    jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_in_1, 'amount', 600.00)),
    'Primer abono parcial'
  );
  SELECT status INTO v_status FROM public.bank_statement_lines WHERE id = v_stmt_line_cr;
  IF v_status <> 'parcialmente_conciliado' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 4A: esperado parcialmente_conciliado, obtenido %', v_status;
  END IF;

  -- 6A. Sobreasignación ($500 sobre $400 pendientes) + verificación atomicidad (PRUEBA 10B)
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 500.00)),
      jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_in_2, 'amount', 400.00)),
      'Sobreasignación'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_cnt FROM public.bank_reconciliation_matches WHERE statement_id = v_stmt_a AND status = 'activo';
  IF v_unexpected_ok OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'Fallo PRUEBA 6A/10B: sobreasignación o falla de atomicidad (matches=%)', v_cnt;
  END IF;

  -- 6B. ID duplicado en la misma solicitud
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(
        jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 200.00),
        jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 200.00)
      ),
      jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_in_2, 'amount', 400.00)),
      'Duplicado'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%duplicado%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 6B: permitió ID bancario duplicado';
  END IF;

  -- 6C. Asiento posterior al corte (entry_date 2026-12-02 > cutoff 2026-11-30)
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_manual_match(
      v_stmt_a,
      jsonb_build_array(jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 250.00)),
      jsonb_build_array(jsonb_build_object('acc_line_id', v_acc_line_fut, 'amount', 250.00)),
      'Asiento futuro'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%posterior a la fecha de corte%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 6C: permitió cruzar asiento posterior al corte';
  END IF;

  -- 4B. Completar resto ($400 crédito + $150 débito en cruce mixto)
  PERFORM public.bank_create_manual_match(
    v_stmt_a,
    jsonb_build_array(
      jsonb_build_object('statement_line_id', v_stmt_line_cr, 'amount', 400.00),
      jsonb_build_object('statement_line_id', v_stmt_line_db, 'amount', 150.00)
    ),
    jsonb_build_array(
      jsonb_build_object('acc_line_id', v_acc_line_in_2,  'amount', 400.00),
      jsonb_build_object('acc_line_id', v_acc_line_out_1, 'amount', 150.00)
    ),
    'Cruce mixto saldo restante'
  );

  SELECT status INTO v_status FROM public.bank_statement_lines WHERE id = v_stmt_line_cr;
  IF v_status <> 'conciliado' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 4B: renglón crédito esperado conciliado, obtenido %', v_status;
  END IF;

  -- Marcar diferencia en comisión $100 y verificar summary sin contaminación de Empresa B ($9999)
  PERFORM public.bank_mark_line_difference(v_stmt_line_extra, true, 'Comisión bancaria sin registrar manualmente');
  v_summary := public.bank_statement_summary(v_stmt_a);
  -- Opening 500 + 1000 credit - 250 debit = 1250; Contabilidad Empresa A = 600 + 400 - 150 = 850 (excluye 250 dic y 9999 B)
  IF (v_summary->>'calculated_bank_closing')::numeric <> 1250.00
     OR (v_summary->>'accounting_balance')::numeric <> 850.00 THEN
    RAISE EXCEPTION 'Fallo PRUEBA 1/4C: summary inconsistente o contaminado: %', v_summary;
  END IF;

  -- =========================================================================
  -- PRUEBA 7: EXTRACTOS CONFIRMADOS (INCLUYENDO PARCIALMENTE_CONCILIADO),
  --           DOBLE CONFIRMACIÓN BLOQUEADA Y REAPERTURA FORMAL
  -- =========================================================================
  -- Agregar 2 renglones a v_stmt_lock ($100 crédito pendiente y $200 crédito pendiente; solo marcamos diferencia o dejamos uno pendiente -> al confirmar queda parcialmente_conciliado o con_diferencia)
  -- Nota: para probar un extracto confirmado en estado EXACTO 'parcialmente_conciliado', reported_closing = null y sin diferencias ni diferencia vs libros (opening=850 => calc=850 == books=850!)
  RESET ROLE;
  UPDATE public.bank_statements
     SET opening_balance = 650.00,
         reported_closing_balance = 850.00
   WHERE id = v_stmt_lock;
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);

  PERFORM public.bank_add_statement_lines(
    v_stmt_lock,
    jsonb_build_array(
      jsonb_build_object('tx_date', '2026-11-10', 'description', 'Linea pendiente 1', 'direction', 'credit', 'amount', 120.00),
      jsonb_build_object('tx_date', '2026-11-11', 'description', 'Linea pendiente 2', 'direction', 'credit', 'amount', 80.00)
    ),
    'manual'
  );
  SELECT id INTO v_lock_line_1 FROM public.bank_statement_lines WHERE statement_id = v_stmt_lock AND amount = 120.00 LIMIT 1;
  SELECT id INTO v_lock_line_2 FROM public.bank_statement_lines WHERE statement_id = v_stmt_lock AND amount = 80.00  LIMIT 1;

  v_status := public.bank_confirm_statement(v_stmt_lock, 'Cierre parcial de prueba');
  IF v_status <> 'parcialmente_conciliado' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7A: esperado parcialmente_conciliado confirmado, obtenido %', v_status;
  END IF;

  -- 7B. Doble confirmación bloqueada sin reapertura formal
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_confirm_statement(v_stmt_lock, 'Segunda confirmacion ilegal');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%ya fue confirmado%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7B: permitió confirmar dos veces sin reabrir (% / %)', v_unexpected_ok, v_err_msg;
  END IF;

  -- 7C. Bloqueo de mutaciones mientras confirmed_at IS NOT NULL (aunque status = parcialmente_conciliado)
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_add_statement_lines(v_stmt_lock, jsonb_build_array(jsonb_build_object('tx_date', '2026-11-12', 'description', 'Ilegal', 'direction', 'credit', 'amount', 10)), 'manual');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'Fallo PRUEBA 7C.1: permitió add_lines en confirmado parcial'; END IF;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_mark_line_difference(v_lock_line_1, true, 'Diferencia ilegal');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'Fallo PRUEBA 7C.2: permitió mark_difference en confirmado parcial'; END IF;

  -- 7D. Permisos de reapertura (contador y gerente bloqueados con 42501; admin_empresa/dueno permitidos)
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_reopen_statement(v_stmt_lock, 'Contador intentando reabrir');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7D.1: contador pudo reabrir extracto';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_reopen_statement(v_stmt_lock, 'Gerente intentando reabrir');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7D.2: gerente pudo reabrir extracto';
  END IF;

  -- También gerente NO puede anular extracto confirmado antes de reabrirlo
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_void_statement(v_stmt_lock, 'Anular sin reabrir');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%confirmado%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7C.3: permitió anular extracto confirmado sin reabrir';
  END IF;

  -- Admin empresa SÍ puede reabrir formalmente
  PERFORM set_config('request.jwt.claim.sub', v_u_adm_emp_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_adm_emp_a::text, 'role', 'authenticated')::text, true);
  v_status := public.bank_reopen_statement(v_stmt_lock, 'Reapertura formal por admin_empresa');
  IF v_status <> 'pendiente' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 7E: estado esperado pendiente tras reabrir, obtenido %', v_status;
  END IF;

  -- =========================================================================
  -- PRUEBA 8: ANULACIONES (CRUCE, RENGLÓN, EXTRACTO) Y PERMISOS DE ANULACIÓN
  -- =========================================================================
  -- Confirmar primero v_stmt_a (para verificar también void_match bloqueado antes de reabrir)
  PERFORM public.bank_confirm_statement(v_stmt_a, 'Cierre v_stmt_a');

  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  SELECT id INTO v_match_id FROM public.bank_reconciliation_matches WHERE match_group_id = v_match_1 AND status = 'activo' LIMIT 1;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_void_match(v_match_id, 'Anular cruce en extracto confirmado');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%Reabre formalmente%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 8A: permitió anular cruce sin reabrir';
  END IF;

  -- Contador NO puede anular renglones, cruces ni extractos (42501)
  PERFORM set_config('request.jwt.claim.sub', v_u_conta_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_conta_a::text, 'role', 'authenticated')::text, true);
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_void_statement_line(v_lock_line_1, 'Contador anulando');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2C/8B: contador pudo anular renglón';
  END IF;

  -- Gerente anula renglón y extracto reabierto v_stmt_lock
  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  PERFORM public.bank_void_statement_line(v_lock_line_1, 'Renglón duplicado en captura manual');
  PERFORM public.bank_void_statement(v_stmt_lock, 'Extracto de prueba descartado');

  -- Reabrir v_stmt_a formalmente como dueño, anular un cruce como gerente y volver a confirmar tras reapertura
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  PERFORM public.bank_reopen_statement(v_stmt_a, 'Reapertura para corregir cruce de prueba');

  PERFORM set_config('request.jwt.claim.sub', v_u_gerente_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_gerente_a::text, 'role', 'authenticated')::text, true);
  PERFORM public.bank_void_match(v_match_id, 'Corrección manual de cruce');
  SELECT status INTO v_status FROM public.bank_statement_lines WHERE id = v_stmt_line_cr;
  IF v_status <> 'parcialmente_conciliado' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 8B.2: tras anular cruce parcial se esperaba parcialmente_conciliado, obtenido %', v_status;
  END IF;

  -- Volver a confirmar v_stmt_a (ahora permitido porque fue reabierto formalmente)
  PERFORM public.bank_confirm_statement(v_stmt_a, 'Re-confirmación válida tras reapertura');

  -- Extracto anulado no puede confirmarse ni reabrirse
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_reopen_statement(v_stmt_lock, 'Reabrir anulado');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_unexpected_ok THEN RAISE EXCEPTION 'Fallo PRUEBA 8C: permitió reabrir extracto anulado'; END IF;

  -- Verificar que acc_entries y acc_lines siguen 100% intactos
  SELECT count(*) INTO v_acc_entries_after FROM public.acc_entries WHERE company_id = v_co_a;
  SELECT count(*) INTO v_acc_lines_after   FROM public.acc_lines   WHERE company_id = v_co_a;
  IF v_acc_entries_after <> v_acc_entries_before OR v_acc_lines_after <> v_acc_lines_before THEN
    RAISE EXCEPTION 'Fallo PRUEBA 4D/8D: la conciliación alteró la contabilidad real';
  END IF;

  -- =========================================================================
  -- PRUEBA 1 & 3: AISLAMIENTO ENTRE EMPRESAS Y ADMIN/SUPER_ADMIN SIN BYPASS
  -- =========================================================================
  -- Dueño B no ve filas de Empresa A por RLS y recibe 42501 en RPCs sobre v_stmt_a
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_b::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_b::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.bank_statements WHERE company_id = v_co_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'Fallo PRUEBA 1A: RLS permitió a Empresa B ver extractos de Empresa A (%)', v_cnt;
  END IF;
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_statement_summary(v_stmt_a);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 1B: Empresa B ejecutó summary de Empresa A';
  END IF;

  -- Admin A y Super Admin A SIN acceso cruzado a Empresa B (ni RLS ni RPC)
  FOREACH v_u_plat IN ARRAY ARRAY[v_u_admin_a, v_u_super_a] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_u_plat::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_plat::text, 'role', 'authenticated')::text, true);

    SELECT count(*) INTO v_cnt FROM public.bank_statements WHERE company_id = v_co_b;
    IF v_cnt <> 0 THEN
      RAISE EXCEPTION 'Fallo PRUEBA 3A: plataforma/admin (%) vio extractos de Empresa B (%)', v_u_plat, v_cnt;
    END IF;

    v_unexpected_ok := false;
    BEGIN
      PERFORM public.bank_statement_summary(v_stmt_b);
      v_unexpected_ok := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
    END;
    IF v_unexpected_ok OR v_err_state <> '42501' THEN
      RAISE EXCEPTION 'Fallo PRUEBA 3B: admin/super_admin (%) accedió al extracto de Empresa B', v_u_plat;
    END IF;

    v_unexpected_ok := false;
    BEGIN
      PERFORM public.bank_upsert_account(null, 'Banco B', 'Bypass', 'ahorros', '1234', v_acc_bank_b, 'COP', null);
      v_unexpected_ok := true;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    END;
    IF v_unexpected_ok THEN
      RAISE EXCEPTION 'Fallo PRUEBA 3C: admin/super_admin (%) vinculó cuenta PUC de Empresa B', v_u_plat;
    END IF;
  END LOOP;

  -- =========================================================================
  -- PRUEBA 2D: TÉCNICO SIN AUTORIZACIÓN vs TÉCNICO CON AUTORIZACIÓN DE SOPORTE
  -- =========================================================================
  PERFORM set_config('request.jwt.claim.sub', v_u_tech_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_tech_a::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.bank_statements WHERE company_id = v_co_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2D.1: técnico sin autorización vio extractos de Empresa A';
  END IF;

  -- Conceder ticket + autorización activa 'accounting'/'lectura_diagnostico' (como propietario)
  RESET ROLE;
  INSERT INTO public.support_tickets (
    id, ticket_number, company_id, company_name, user_id, user_name, user_email, user_role,
    category, subject, description, module_page
  ) VALUES (
    gen_random_uuid(), 'TCK-BK-001', v_co_a, 'Banco Test Empresa A', v_u_dueno_a,
    'Dueno Test A', 'bk_dueno_a@test.local', 'dueno', 'contabilidad',
    'Diagnóstico conciliación', 'Revisión lectura conciliación', 'bankrecon'
  ) RETURNING id INTO v_ticket_id;

  INSERT INTO public.support_authorizations (
    ticket_id, company_id, granted_by, technician_id, module_name, authorization_scope, expires_at
  ) VALUES (
    v_ticket_id, v_co_a, v_u_dueno_a, v_u_tech_a, 'accounting', 'lectura_diagnostico', now() + interval '2 hours'
  );

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_u_tech_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_tech_a::text, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.bank_statements WHERE company_id = v_co_a;
  IF v_cnt = 0 THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2D.2: técnico con autorización soporte accounting/lectura_diagnostico no pudo leer por RLS';
  END IF;
  -- Técnico con lectura soporte NO puede ejecutar RPCs operativas
  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_statement(v_bank_acc_a, '2026-11-01', '2026-11-30', '2026-11-30', 0, null, 'Tech write');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 2D.3: técnico pudo ejecutar RPC de escritura';
  END IF;

  -- =========================================================================
  -- PRUEBA 1C (NIVEL DB): INTEGRIDAD COMPUESTA ENTRE EMPRESAS (FKs + TRIGGERS)
  -- =========================================================================
  RESET ROLE;
  v_unexpected_ok := false;
  BEGIN
    INSERT INTO public.bank_accounts (
      company_id, acc_account_id, bank_name, account_alias, account_type,
      account_number_last4, account_number_masked
    ) VALUES (
      v_co_a, v_acc_bank_b, 'Banco Intruso', 'Alias', 'ahorros', '9999', '****9999'
    );
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok THEN
    RAISE EXCEPTION 'Fallo PRUEBA 1C: trigger permitió cuenta bancaria de Empresa A apuntando a PUC de Empresa B';
  END IF;

  -- =========================================================================
  -- PRUEBA 9D: PERIODOS CONTABLES CERRADOS
  -- =========================================================================
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', v_u_dueno_a::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u_dueno_a::text, 'role', 'authenticated')::text, true);

  RESET ROLE;
  UPDATE public.acc_periods SET status = 'cerrado' WHERE company_id = v_co_a AND year = 2026 AND month = 11;
  SET LOCAL ROLE authenticated;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_reopen_statement(v_stmt_a, 'Reapertura ilegal en periodo cerrado');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%cerrado%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 9D.1: permitió reabrir extracto con periodo contable cerrado';
  END IF;

  v_unexpected_ok := false;
  BEGIN
    PERFORM public.bank_create_statement(v_bank_acc_a, '2026-11-01', '2026-11-30', '2026-11-30', 0, null, 'Nuevo en cerrado');
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
  END;
  IF v_unexpected_ok OR v_err_msg NOT ILIKE '%cerrado%' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 9D.2: permitió crear extracto en periodo contable cerrado';
  END IF;

  -- =========================================================================
  -- PRUEBA 11: PROTECCIÓN INMUTABLE DE AUDITORÍA (bank_reconciliation_events)
  -- =========================================================================
  RESET ROLE;
  SELECT id INTO v_event_id FROM public.bank_reconciliation_events WHERE statement_id = v_stmt_a LIMIT 1;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Fallo PRUEBA 11A: faltan eventos de auditoría en bank_reconciliation_events';
  END IF;

  v_unexpected_ok := false;
  BEGIN
    UPDATE public.bank_reconciliation_events SET action = 'tampered' WHERE id = v_event_id;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 11B: se permitió UPDATE en bank_reconciliation_events (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  v_unexpected_ok := false;
  BEGIN
    DELETE FROM public.bank_reconciliation_events WHERE id = v_event_id;
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  IF v_unexpected_ok OR v_err_state <> '42501' THEN
    RAISE EXCEPTION 'Fallo PRUEBA 11C: se permitió DELETE en bank_reconciliation_events (%, %)', v_unexpected_ok, v_err_state;
  END IF;

  -- Verificación de preservación de helpers compartidos previos
  IF to_regprocedure('public._require_company_roles(text[])') IS NULL
     OR to_regprocedure('public._es_finito(numeric)') IS NULL THEN
    RAISE EXCEPTION 'Fallo verificación de compatibilidad: faltan helpers compartidos previos';
  END IF;

  RAISE NOTICE 'TODAS LAS 12 PRUEBAS DE CONCILIACIÓN BANCARIA MANUAL PASARON CORRECTAMENTE';
END
$$;

ROLLBACK;
