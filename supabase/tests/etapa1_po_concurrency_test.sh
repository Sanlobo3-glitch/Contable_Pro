#!/usr/bin/env bash
# supabase/tests/etapa1_po_concurrency_test.sh
# Procedimiento reproducible de prueba de concurrencia REAL (multi-sesión) para
# numeración atómica de órdenes de compra (Bloqueante B / migración 000068).
#
# IMPORTANTE:
# - Ejecutar EXCLUSIVAMENTE contra una base PostgreSQL 17 de PRUEBAS (nunca contra producción).
# - Requiere haber aplicado previamente hasta la migración 20261118000068_cierre_bloqueantes_etapa1.sql.
#
# Uso:
#   TEST_PG_URI="postgresql://postgres:postgres@localhost:5432/contable_test" bash supabase/tests/etapa1_po_concurrency_test.sh

set -euo pipefail

if [[ -z "${TEST_PG_URI:-}" ]]; then
  echo "ERROR: Debes definir TEST_PG_URI apuntando a una instancia PostgreSQL de pruebas." >&2
  exit 1
fi

if [[ "${TEST_PG_URI}" =~ supabase\.(co|in) ]]; then
  echo "ABORTADO: TEST_PG_URI apunta a Supabase; esta prueba solo puede ejecutarse en PostgreSQL de pruebas local o aislado." >&2
  exit 1
fi

CO_A="cccccccc-0000-4000-8000-000000000001"
CO_B="cccccccc-0000-4000-8000-000000000002"
U_A="cccccccc-1111-4000-8000-000000000001"
U_B="cccccccc-1111-4000-8000-000000000002"
WH_A="cccccccc-2222-4000-8000-000000000001"
WH_B="cccccccc-2222-4000-8000-000000000002"
SUP_A="cccccccc-3333-4000-8000-000000000001"
SUP_B="cccccccc-3333-4000-8000-000000000002"
PROD_A="cccccccc-4444-4000-8000-000000000001"
PROD_B="cccccccc-4444-4000-8000-000000000002"

cleanup() {
  psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 -q <<SQL || true
DELETE FROM public.purchase_order_items WHERE company_id IN ('${CO_A}', '${CO_B}');
DELETE FROM public.purchase_orders WHERE company_id IN ('${CO_A}', '${CO_B}');
DELETE FROM public.purchase_order_counters WHERE company_id IN ('${CO_A}', '${CO_B}');
DELETE FROM public.products WHERE id IN ('${PROD_A}', '${PROD_B}');
DELETE FROM public.suppliers WHERE id IN ('${SUP_A}', '${SUP_B}');
DELETE FROM public.warehouses WHERE id IN ('${WH_A}', '${WH_B}');
DELETE FROM public.profiles WHERE id IN ('${U_A}', '${U_B}');
DELETE FROM auth.users WHERE id IN ('${U_A}', '${U_B}');
DELETE FROM public.companies WHERE id IN ('${CO_A}', '${CO_B}');
SQL
}
trap cleanup EXIT

echo "[1/4] Preparando empresas aisladas e historial previo (OC-0005 en Empresa A)..."
psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 -q <<SQL
INSERT INTO public.companies (id, name, active)
VALUES ('${CO_A}', 'Test Concurrencia A', true), ('${CO_B}', 'Test Concurrencia B', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('${U_A}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conc_a@test.local', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
  ('${U_B}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conc_b@test.local', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name, role, company_id, active)
VALUES
  ('${U_A}', 'conc_a@test.local', 'Comprador Conc A', 'comprador', '${CO_A}', true),
  ('${U_B}', 'conc_b@test.local', 'Dueño Conc B', 'dueno', '${CO_B}', true)
ON CONFLICT (id) DO UPDATE SET role = excluded.role, company_id = excluded.company_id, active = true;

INSERT INTO public.warehouses (id, company_id, name, code, active)
VALUES ('${WH_A}', '${CO_A}', 'Bodega Conc A', 'CA-1', true), ('${WH_B}', '${CO_B}', 'Bodega Conc B', 'CB-1', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.suppliers (id, company_id, name, active)
VALUES ('${SUP_A}', '${CO_A}', 'Prov Conc A', true), ('${SUP_B}', '${CO_B}', 'Prov Conc B', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, company_id, name, sku, stock, cost, price, active)
VALUES ('${PROD_A}', '${CO_A}', 'Prod Conc A', 'SKU-CA', 100, 1000, 1500, true),
       ('${PROD_B}', '${CO_B}', 'Prod Conc B', 'SKU-CB', 100, 1000, 1500, true)
ON CONFLICT (id) DO NOTHING;

-- Orden histórica previa OC-0005 (simula historial y salto previo sin reiniciar contador)
INSERT INTO public.purchase_orders (company_id, po_number, supplier_id, supplier_name, status, payment_terms, subtotal, total, created_by)
VALUES ('${CO_A}', 'OC-0005', '${SUP_A}', 'Prov Conc A', 'draft', 'credito', 1000, 1000, '${U_A}');

INSERT INTO public.purchase_order_counters (company_id, last_seq)
VALUES ('${CO_A}', 5)
ON CONFLICT (company_id) DO UPDATE SET last_seq = greatest(public.purchase_order_counters.last_seq, 5);
SQL

run_create_po() {
  local user_id="$1"
  local sup_id="$2"
  local prod_id="$3"
  local wh_id="$4"
  local sleep_sec="${5:-0}"
  local label="$6"

  psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 -At <<SQL
BEGIN;
SELECT set_config('request.jwt.claim.sub', '${user_id}', true);
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', '${user_id}', 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
SELECT public.crear_orden_compra(
  '${sup_id}'::uuid,
  jsonb_build_array(jsonb_build_object('product_id', '${prod_id}', 'ordered_qty', 1, 'unit_cost', 1000)),
  NULL,
  '${wh_id}'::uuid,
  'credito',
  30,
  current_date + 3,
  '${label}',
  false
);
RESET ROLE;
SELECT CASE WHEN ${sleep_sec} > 0 THEN pg_sleep(${sleep_sec}) ELSE NULL END;
COMMIT;
SQL
}

echo "[2/4] Prueba 1: Contención simultánea de 2 sesiones con transacción abierta en Empresa A..."
TMP_OUT_1=$(mktemp)
TMP_OUT_2=$(mktemp)
trap 'rm -f "$TMP_OUT_1" "$TMP_OUT_2"; cleanup' EXIT

run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "2" "contencion-s1" >"$TMP_OUT_1" &
PID_1=$!
sleep 0.3
run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "0" "contencion-s2" >"$TMP_OUT_2" &
PID_2=$!

wait "$PID_1" "$PID_2"

echo "[3/4] Prueba 2: Ráfaga concurrente (5 sesiones Empresa A + 3 sesiones Empresa B en paralelo)..."
PIDS=()
for i in 1 2 3 4 5; do
  run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "0" "burst-a-${i}" >/dev/null &
  PIDS+=($!)
done
for j in 1 2 3; do
  run_create_po "${U_B}" "${SUP_B}" "${PROD_B}" "${WH_B}" "0" "burst-b-${j}" >/dev/null &
  PIDS+=($!)
done
for pid in "${PIDS[@]}"; do
  wait "$pid"
done

echo "[4/4] Verificando invariantes finales en PostgreSQL..."
psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE
  v_cnt_a int;
  v_dist_a int;
  v_seq_a int;
  v_nums_a text;
  v_cnt_b int;
  v_dist_b int;
  v_seq_b int;
  v_nums_b text;
  v_err_state text;
  v_unexpected_ok boolean := false;
BEGIN
  SELECT count(*), count(DISTINCT po_number), string_agg(po_number, ',' ORDER BY po_number)
    INTO v_cnt_a, v_dist_a, v_nums_a
    FROM public.purchase_orders
   WHERE company_id = '${CO_A}';

  SELECT last_seq INTO v_seq_a
    FROM public.purchase_order_counters
   WHERE company_id = '${CO_A}';

  -- 1 histórica (OC-0005) + 2 contención + 5 ráfaga = 8 órdenes (OC-0005..OC-0012)
  ASSERT v_cnt_a = 8, format('Órdenes perdidas en Empresa A: esperadas 8, encontradas %s', v_cnt_a);
  ASSERT v_dist_a = 8, format('Números duplicados en Empresa A: %s', v_nums_a);
  ASSERT v_seq_a = 12, format('Contador incoherente en Empresa A: esperado 12, encontrado %s', v_seq_a);
  ASSERT v_nums_a = 'OC-0005,OC-0006,OC-0007,OC-0008,OC-0009,OC-0010,OC-0011,OC-0012',
    format('Secuencia inesperada en Empresa A: %s', v_nums_a);

  SELECT count(*), count(DISTINCT po_number), string_agg(po_number, ',' ORDER BY po_number)
    INTO v_cnt_b, v_dist_b, v_nums_b
    FROM public.purchase_orders
   WHERE company_id = '${CO_B}';

  SELECT last_seq INTO v_seq_b
    FROM public.purchase_order_counters
   WHERE company_id = '${CO_B}';

  ASSERT v_cnt_b = 3, format('Órdenes perdidas en Empresa B: esperadas 3, encontradas %s', v_cnt_b);
  ASSERT v_dist_b = 3, format('Números duplicados en Empresa B: %s', v_nums_b);
  ASSERT v_seq_b = 3, format('Contador incoherente en Empresa B: esperado 3, encontrado %s', v_seq_b);
  ASSERT v_nums_b = 'OC-0001,OC-0002,OC-0003',
    format('Secuencia inesperada en Empresa B: %s', v_nums_b);

  -- Restricción UNIQUE impide duplicado directo incluso saltando la RPC
  BEGIN
    INSERT INTO public.purchase_orders (company_id, po_number, status, payment_terms, subtotal, total)
    VALUES ('${CO_A}', 'OC-0006', 'draft', 'credito', 0, 0);
    v_unexpected_ok := true;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_state = RETURNED_SQLSTATE;
  END;
  ASSERT NOT v_unexpected_ok AND v_err_state = '23505',
    format('UNIQUE (company_id, po_number) no bloqueó inserción directa duplicada (SQLSTATE=%s)', v_err_state);

  RAISE NOTICE 'CONCURRENCIA OC OK: Empresa A=[%] (seq=%), Empresa B=[%] (seq=%), UNIQUE 23505 verificado.',
    v_nums_a, v_seq_a, v_nums_b, v_seq_b;
END \$\$;
SQL

echo "PRUEBA DE CONCURRENCIA MULTI-SESIÓN COMPLETADA CON ÉXITO."
