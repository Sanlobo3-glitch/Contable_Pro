#!/usr/bin/env bash
# supabase/tests/etapa1_po_concurrency_test.sh
# Procedimiento reproducible de prueba de concurrencia REAL (multi-sesión) para
# numeración atómica de órdenes de compra (Bloqueante B / migración 000068).
#
# IMPORTANTE:
# - Ejecutar EXCLUSIVAMENTE contra PostgreSQL 17 LOCAL de PRUEBAS (127.0.0.1, [::1] o localhost verificado como loopback).
# - Prohibido ejecutar contra Supabase, hosts remotos, alias DNS externos o entornos de producción.
# - Requiere haber aplicado previamente hasta la migración 20261118000068_cierre_bloqueantes_etapa1.sql.
#
# Uso:
#   TEST_PG_URI="postgresql://postgres:postgres@127.0.0.1:5432/contable_test" bash supabase/tests/etapa1_po_concurrency_test.sh

set -euo pipefail

abort_conn() {
  echo "ABORTADO: $1" >&2
  exit 1
}

verify_localhost_resolution() {
  local resolved=()
  local ip line

  if command -v getent >/dev/null 2>&1; then
    while IFS= read -r line; do
      ip="${line%%[[:space:]]*}"
      [[ -n "$ip" ]] && resolved+=("$ip")
    done < <(getent ahosts localhost 2>/dev/null || true)
  elif command -v python3 >/dev/null 2>&1; then
    while IFS= read -r ip; do
      [[ -n "$ip" ]] && resolved+=("$ip")
    done < <(python3 -c 'import socket; infos=socket.getaddrinfo("localhost", None); print("\n".join(sorted({i[4][0].split("%")[0] for i in infos})))' 2>/dev/null || true)
  else
    return 1
  fi

  if [[ "${#resolved[@]}" -eq 0 ]]; then
    return 1
  fi

  for ip in "${resolved[@]}"; do
    case "$ip" in
      127.0.0.1|::1) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

is_allowed_local_host() {
  local h
  h=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  h="${h#[}"
  h="${h%]}"
  case "$h" in
    127.0.0.1|::1) return 0 ;;
    localhost)
      verify_localhost_resolution || abort_conn "localhost no pudo demostrarse resuelto exclusivamente a loopback (127.0.0.1 o ::1)."
      return 0
      ;;
    *) return 1 ;;
  esac
}

if [[ -z "${TEST_PG_URI:-}" ]]; then
  abort_conn "Debes definir TEST_PG_URI apuntando exclusivamente a una instancia PostgreSQL local (127.0.0.1, [::1] o localhost verificado)."
fi

# 1. Bloqueo estricto de variables libpq que puedan redirigir o alterar la conexión
for forbidden_var in PGSERVICE PGSERVICEFILE PGSYSCONFDIR PGOPTIONS PGREALM; do
  if [[ -n "${!forbidden_var:-}" ]]; then
    abort_conn "La variable libpq ${forbidden_var} no está permitida en esta prueba."
  fi
done

if [[ -n "${PGHOST:-}" ]]; then
  PGHOST_LOWER=$(printf '%s' "${PGHOST}" | tr '[:upper:]' '[:lower:]')
  if [[ "${PGHOST_LOWER}" =~ supabase ]]; then
    abort_conn "Dominio de Supabase detectado en PGHOST; ejecución prohibida."
  fi
  is_allowed_local_host "${PGHOST}" || abort_conn "PGHOST no apunta a un destino loopback permitido (127.0.0.1, ::1 o localhost verificado): ${PGHOST}"
fi

if [[ -n "${PGHOSTADDR:-}" ]]; then
  PGHOSTADDR_LOWER=$(printf '%s' "${PGHOSTADDR}" | tr '[:upper:]' '[:lower:]')
  case "${PGHOSTADDR_LOWER}" in
    127.0.0.1|::1) ;;
    *) abort_conn "PGHOSTADDR no apunta a loopback permitido (127.0.0.1 o ::1): ${PGHOSTADDR}" ;;
  esac
fi

if [[ "${APP_ENV:-}" == "production" ]] || [[ "${NODE_ENV:-}" == "production" ]]; then
  abort_conn "Entorno de producción detectado en APP_ENV/NODE_ENV; ejecución prohibida."
fi

URI_RAW="${TEST_PG_URI}"
URI_LOWER=$(printf '%s' "${URI_RAW}" | tr '[:upper:]' '[:lower:]')
PGDATABASE_LOWER=$(printf '%s' "${PGDATABASE:-}" | tr '[:upper:]' '[:lower:]')

if [[ "${URI_RAW}" =~ [[:space:]] ]] || [[ "${URI_RAW}" == *"%"* ]]; then
  abort_conn "TEST_PG_URI contiene espacios o codificación porcentual no permitida en validación estricta local."
fi

if [[ "${URI_LOWER}" =~ (supabase\.(co|in|com|net|org)|\.supabase\.) ]]; then
  abort_conn "Dominio de Supabase detectado; esta prueba solo puede ejecutarse en PostgreSQL local de pruebas."
fi

if [[ "${URI_LOWER}" =~ (^|[^[:alnum:]])prod(uction)?([^[:alnum:]]|$) ]] || [[ "${PGDATABASE_LOWER}" =~ (^|[^[:alnum:]])prod(uction)?([^[:alnum:]]|$) ]]; then
  abort_conn "Se detectó un indicador de producción en TEST_PG_URI o PGDATABASE; ejecución prohibida."
fi

# Exigir formato URI explícito postgres:// o postgresql:// con autoridad local demostrable
if [[ ! "${URI_LOWER}" =~ ^postgres(ql)?://(.+)$ ]]; then
  abort_conn "TEST_PG_URI debe usar formato explícito postgresql://... o postgres://... con host loopback (127.0.0.1, [::1] o localhost verificado)."
fi

REST_AFTER_SCHEME="${BASH_REMATCH[2]}"
AUTHORITY_PART="${REST_AFTER_SCHEME%%[/?#]*}"
PATH_AND_QUERY="${REST_AFTER_SCHEME#"$AUTHORITY_PART"}"

if [[ -z "${AUTHORITY_PART}" ]]; then
  abort_conn "No se puede demostrar destino local: falta autoridad/host explícito en TEST_PG_URI."
fi

HOST_PORT_PART="${AUTHORITY_PART##*@}"
if [[ -z "${HOST_PORT_PART}" ]] || [[ "${HOST_PORT_PART}" == *","* ]]; then
  abort_conn "Host inválido o multi-host no permitido en TEST_PG_URI."
fi

URI_HOST=""
if [[ "${HOST_PORT_PART}" =~ ^\[(::1)\](:[0-9]{1,5})?$ ]]; then
  URI_HOST="${BASH_REMATCH[1]}"
elif [[ "${HOST_PORT_PART}" =~ ^([a-zA-Z0-9.-]+)(:[0-9]{1,5})?$ ]]; then
  URI_HOST="${BASH_REMATCH[1]}"
else
  abort_conn "No se pudo verificar host local en TEST_PG_URI: ${HOST_PORT_PART}"
fi

is_allowed_local_host "${URI_HOST}" || abort_conn "Destino no local rechazado (${URI_HOST}); solo se permite 127.0.0.1, ::1 o localhost verificado."

# Validar parámetros query que puedan redirigir host/hostaddr/service/options
if [[ "${PATH_AND_QUERY}" == *"?"* ]]; then
  QUERY_STRING="${PATH_AND_QUERY#*\?}"
  QUERY_STRING="${QUERY_STRING%%#*}"
  IFS='&' read -ra QUERY_PAIRS <<< "${QUERY_STRING}"
  for kv in "${QUERY_PAIRS[@]}"; do
    [[ -z "$kv" ]] && continue
    q_key=$(printf '%s' "${kv%%=*}" | tr '[:upper:]' '[:lower:]')
    q_val="${kv#*=}"
    q_val_lower=$(printf '%s' "$q_val" | tr '[:upper:]' '[:lower:]')
    case "$q_key" in
      service|servicefile|options|passfile)
        abort_conn "Parámetro libpq '${q_key}' no está permitido en TEST_PG_URI."
        ;;
      host)
        if [[ "$q_val" == *","* ]]; then
          abort_conn "Parámetro query multi-host no permitido: ${q_val}"
        fi
        is_allowed_local_host "$q_val_lower" || abort_conn "Parámetro query host= no local rechazado: ${q_val}"
        ;;
      hostaddr)
        case "$q_val_lower" in
          127.0.0.1|::1) ;;
          *) abort_conn "Parámetro query hostaddr= no local rechazado: ${q_val}" ;;
        esac
        ;;
    esac
  done
fi

# Neutralizar variables libpq antes de invocar psql
unset PGSERVICE PGSYSCONFDIR PGHOST PGHOSTADDR PGDATABASE PGPORT PGUSER PGOPTIONS PGREALM
export PGSERVICEFILE=/dev/null

gen_uuid() {
  if [[ -r /proc/sys/kernel/random/uuid ]]; then
    tr '[:upper:]' '[:lower:]' < /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr '[:upper:]' '[:lower:]'
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import uuid; print(str(uuid.uuid4()))'
  elif command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 16 | sed -E 's/^(.{8})(.{4}).(.{3}).(.{3})(.{12})$/\1-\2-4\3-8\4-\5/'
  else
    echo "ERROR: No hay generador de UUID disponible en el sistema." >&2
    exit 1
  fi
}

RUN_TAG="$(date -u +%Y%m%d%H%M%S)_$$_${RANDOM}"
CO_A="$(gen_uuid)"
CO_B="$(gen_uuid)"
U_A="$(gen_uuid)"
U_B="$(gen_uuid)"
WH_A="$(gen_uuid)"
WH_B="$(gen_uuid)"
SUP_A="$(gen_uuid)"
SUP_B="$(gen_uuid)"
PROD_A="$(gen_uuid)"
PROD_B="$(gen_uuid)"
HIST_PO_ID="$(gen_uuid)"

UNIQUE_COUNT=$(printf '%s\n' "${CO_A}" "${CO_B}" "${U_A}" "${U_B}" "${WH_A}" "${WH_B}" "${SUP_A}" "${SUP_B}" "${PROD_A}" "${PROD_B}" "${HIST_PO_ID}" | sort -u | wc -l | tr -d ' ')
if [[ "${UNIQUE_COUNT}" -ne 11 ]]; then
  echo "ERROR: Colisión interna al generar UUIDs exclusivos para la ejecución." >&2
  exit 1
fi

EMAIL_A="conc_a_${RUN_TAG}@test.local"
EMAIL_B="conc_b_${RUN_TAG}@test.local"
CO_A_NAME="Test Concurrencia A ${RUN_TAG}"
CO_B_NAME="Test Concurrencia B ${RUN_TAG}"

SETUP_COMMITTED=0
SESSION_OUT_FILES=()

cleanup() {
  local orig_rc=$?
  local created_po_ids=("${HIST_PO_ID}")
  local f line po_id_sql_list cleanup_rc=0

  for f in "${SESSION_OUT_FILES[@]:-}"; do
    if [[ -n "$f" ]] && [[ -f "$f" ]]; then
      while IFS= read -r line; do
        line=$(printf '%s' "$line" | tr -d '[:space:]')
        if [[ "$line" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
          created_po_ids+=("$line")
        fi
      done < "$f"
      rm -f "$f" 2>/dev/null || true
    fi
  done

  if [[ "${SETUP_COMMITTED}" -ne 1 ]]; then
    exit "${orig_rc}"
  fi

  if [[ -z "${CO_A:-}" ]] || [[ -z "${CO_B:-}" ]] || [[ -z "${HIST_PO_ID:-}" ]] || [[ -z "${RUN_TAG:-}" ]]; then
    echo "ERROR DE LIMPIEZA: Faltan identificadores de la ejecución para demostrar limpieza segura. Posibles residuos en empresas ${CO_A:-?} / ${CO_B:-?}." >&2
    exit 1
  fi

  po_id_sql_list=$(printf "'%s'," "${created_po_ids[@]}")
  po_id_sql_list="${po_id_sql_list%,}"

  set +e
  psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;

DO \$\$
DECLARE
  v_unverified int := 0;
BEGIN
  SELECT count(*) INTO v_unverified
    FROM public.companies
   WHERE id IN ('${CO_A}', '${CO_B}')
     AND name NOT IN ('${CO_A_NAME}', '${CO_B_NAME}');
  IF v_unverified > 0 THEN
    RAISE EXCEPTION 'Limpieza abortada: las empresas % / % no coinciden con los nombres exclusivos de esta ejecución (%)', '${CO_A}', '${CO_B}', '${RUN_TAG}';
  END IF;

  SELECT count(*) INTO v_unverified
    FROM public.purchase_orders po
   WHERE po.company_id IN ('${CO_A}', '${CO_B}')
     AND NOT (
       po.supplier_id IN ('${SUP_A}', '${SUP_B}')
       AND po.created_by IN ('${U_A}', '${U_B}')
       AND (po.id IN (${po_id_sql_list}) OR po.notes LIKE '%-${RUN_TAG}')
     );
  IF v_unverified > 0 THEN
    RAISE EXCEPTION 'Limpieza abortada: se detectaron % órdenes bajo %/% no atribuibles a esta ejecución (%)', v_unverified, '${CO_A}', '${CO_B}', '${RUN_TAG}';
  END IF;
END \$\$;

DELETE FROM public.purchase_order_items poi
 WHERE poi.product_id IN ('${PROD_A}', '${PROD_B}')
   AND poi.po_id IN (
     SELECT po.id
       FROM public.purchase_orders po
       JOIN public.companies c ON c.id = po.company_id
      WHERE c.id IN ('${CO_A}', '${CO_B}')
        AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
        AND po.supplier_id IN ('${SUP_A}', '${SUP_B}')
        AND po.created_by IN ('${U_A}', '${U_B}')
        AND (po.id IN (${po_id_sql_list}) OR po.notes LIKE '%-${RUN_TAG}')
   );

DELETE FROM public.purchase_orders po
 USING public.companies c
 WHERE c.id = po.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND po.supplier_id IN ('${SUP_A}', '${SUP_B}')
   AND po.created_by IN ('${U_A}', '${U_B}')
   AND (po.id IN (${po_id_sql_list}) OR po.notes LIKE '%-${RUN_TAG}');

DELETE FROM public.purchase_order_counters poc
 USING public.companies c
 WHERE c.id = poc.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}');

DELETE FROM public.audit_log al
 USING public.companies c
 WHERE c.id = al.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND (
     al.user_id IN ('${U_A}', '${U_B}')
     OR al.record_id::text IN (${po_id_sql_list}, '${CO_A}', '${CO_B}', '${U_A}', '${U_B}', '${WH_A}', '${WH_B}', '${SUP_A}', '${SUP_B}', '${PROD_A}', '${PROD_B}')
   );

DELETE FROM public.products p
 USING public.companies c
 WHERE c.id = p.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND p.id IN ('${PROD_A}', '${PROD_B}')
   AND p.sku IN ('SKU-CA-${RUN_TAG}', 'SKU-CB-${RUN_TAG}');

DELETE FROM public.suppliers s
 USING public.companies c
 WHERE c.id = s.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND s.id IN ('${SUP_A}', '${SUP_B}')
   AND s.document IN ('900-${RUN_TAG}-A', '900-${RUN_TAG}-B');

DELETE FROM public.warehouses w
 USING public.companies c
 WHERE c.id = w.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND w.id IN ('${WH_A}', '${WH_B}')
   AND w.code IN ('CA-${RUN_TAG}', 'CB-${RUN_TAG}');

DELETE FROM public.profiles pr
 USING public.companies c
 WHERE c.id = pr.company_id
   AND c.id IN ('${CO_A}', '${CO_B}')
   AND c.name IN ('${CO_A_NAME}', '${CO_B_NAME}')
   AND pr.id IN ('${U_A}', '${U_B}')
   AND pr.email IN ('${EMAIL_A}', '${EMAIL_B}');

DELETE FROM auth.users
 WHERE id IN ('${U_A}', '${U_B}')
   AND email IN ('${EMAIL_A}', '${EMAIL_B}');

DELETE FROM public.companies
 WHERE id IN ('${CO_A}', '${CO_B}')
   AND name IN ('${CO_A_NAME}', '${CO_B_NAME}');

COMMIT;
SQL
  cleanup_rc=$?
  set -e

  if [[ "${cleanup_rc}" -ne 0 ]]; then
    echo "ERROR DE LIMPIEZA (rc=${cleanup_rc}): Falló la eliminación segura de los datos creados en la ejecución ${RUN_TAG}. Posibles residuos aislados: empresas [${CO_A}, ${CO_B}] (${CO_A_NAME}, ${CO_B_NAME}), usuarios [${U_A}, ${U_B}], bodegas [${WH_A}, ${WH_B}], proveedores [${SUP_A}, ${SUP_B}], productos [${PROD_A}, ${PROD_B}], órdenes [${po_id_sql_list}]." >&2
    exit "${cleanup_rc}"
  fi

  exit "${orig_rc}"
}
trap cleanup EXIT

echo "[1/4] Verificando ausencia de colisiones y preparando empresas aisladas (${RUN_TAG})..."
psql "${TEST_PG_URI}" -v ON_ERROR_STOP=1 -q <<SQL
BEGIN;

DO \$\$
DECLARE
  v_hits int := 0;
BEGIN
  SELECT count(*) INTO v_hits FROM public.companies WHERE id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: UUID de empresa ya existe en la base'; END IF;

  SELECT count(*) INTO v_hits FROM auth.users WHERE id IN ('${U_A}', '${U_B}') OR email IN ('${EMAIL_A}', '${EMAIL_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: usuario o email de prueba ya existe en auth.users'; END IF;

  SELECT count(*) INTO v_hits FROM public.profiles WHERE id IN ('${U_A}', '${U_B}') OR company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: perfil de prueba ya existe en public.profiles'; END IF;

  SELECT count(*) INTO v_hits FROM public.warehouses WHERE id IN ('${WH_A}', '${WH_B}') OR company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: bodega de prueba ya existe en public.warehouses'; END IF;

  SELECT count(*) INTO v_hits FROM public.suppliers WHERE id IN ('${SUP_A}', '${SUP_B}') OR company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: proveedor de prueba ya existe en public.suppliers'; END IF;

  SELECT count(*) INTO v_hits FROM public.products WHERE id IN ('${PROD_A}', '${PROD_B}') OR company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: producto de prueba ya existe en public.products'; END IF;

  SELECT count(*) INTO v_hits FROM public.purchase_orders WHERE id = '${HIST_PO_ID}' OR company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: órdenes preexistentes para UUID generado'; END IF;

  SELECT count(*) INTO v_hits
    FROM public.purchase_order_items
   WHERE company_id IN ('${CO_A}', '${CO_B}')
      OR po_id = '${HIST_PO_ID}'
      OR product_id IN ('${PROD_A}', '${PROD_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: ítems de orden preexistentes para UUID generado'; END IF;

  SELECT count(*) INTO v_hits FROM public.purchase_order_counters WHERE company_id IN ('${CO_A}', '${CO_B}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: contador preexistente para UUID generado'; END IF;

  SELECT count(*) INTO v_hits
    FROM public.audit_log
   WHERE company_id IN ('${CO_A}', '${CO_B}')
      OR user_id IN ('${U_A}', '${U_B}')
      OR record_id::text IN ('${CO_A}', '${CO_B}', '${U_A}', '${U_B}', '${WH_A}', '${WH_B}', '${SUP_A}', '${SUP_B}', '${PROD_A}', '${PROD_B}', '${HIST_PO_ID}');
  IF v_hits > 0 THEN RAISE EXCEPTION 'Abortado: registros de auditoría preexistentes para UUID generado'; END IF;
END \$\$;

INSERT INTO public.companies (id, name)
VALUES ('${CO_A}', '${CO_A_NAME}'), ('${CO_B}', '${CO_B_NAME}');

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('${U_A}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${EMAIL_A}', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb),
  ('${U_B}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${EMAIL_B}', '', now(), now(), now(), '{"provider":"email"}'::jsonb, '{}'::jsonb);

INSERT INTO public.profiles (id, email, full_name, role, company_id, active)
VALUES
  ('${U_A}', '${EMAIL_A}', 'Comprador Conc A', 'comprador', '${CO_A}', true),
  ('${U_B}', '${EMAIL_B}', 'Dueño Conc B', 'dueno', '${CO_B}', true);

INSERT INTO public.warehouses (id, company_id, name, code, active)
VALUES ('${WH_A}', '${CO_A}', 'Bodega Conc A', 'CA-${RUN_TAG}', true), ('${WH_B}', '${CO_B}', 'Bodega Conc B', 'CB-${RUN_TAG}', true);

INSERT INTO public.suppliers (id, company_id, name, document)
VALUES ('${SUP_A}', '${CO_A}', 'Prov Conc A', '900-${RUN_TAG}-A'), ('${SUP_B}', '${CO_B}', 'Prov Conc B', '900-${RUN_TAG}-B');

INSERT INTO public.products (id, company_id, name, sku, stock, cost, price, tracks_expiry)
VALUES ('${PROD_A}', '${CO_A}', 'Prod Conc A', 'SKU-CA-${RUN_TAG}', 100, 1000, 1500, false),
       ('${PROD_B}', '${CO_B}', 'Prod Conc B', 'SKU-CB-${RUN_TAG}', 100, 1000, 1500, false);

-- Orden histórica previa OC-0005 (simula historial y salto previo sin reiniciar contador)
INSERT INTO public.purchase_orders (id, company_id, po_number, supplier_id, supplier_name, status, payment_terms, subtotal, total, notes, created_by)
VALUES ('${HIST_PO_ID}', '${CO_A}', 'OC-0005', '${SUP_A}', 'Prov Conc A', 'draft', 'credito', 1000, 1000, 'hist-${RUN_TAG}', '${U_A}');

INSERT INTO public.purchase_order_counters (company_id, last_seq)
VALUES ('${CO_A}', 5);

COMMIT;
SQL
SETUP_COMMITTED=1

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
  '${label}-${RUN_TAG}',
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
SESSION_OUT_FILES+=("$TMP_OUT_1" "$TMP_OUT_2")

run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "2" "contencion-s1" >"$TMP_OUT_1" &
PID_1=$!
sleep 0.3
run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "0" "contencion-s2" >"$TMP_OUT_2" &
PID_2=$!

STEP_RC=0
wait "$PID_1" || STEP_RC=$?
wait "$PID_2" || STEP_RC=$?
if [[ "${STEP_RC}" -ne 0 ]]; then
  echo "ERROR: Falló una sesión en la prueba de contención simultánea (rc=${STEP_RC})." >&2
  exit "${STEP_RC}"
fi

echo "[3/4] Prueba 2: Ráfaga concurrente (5 sesiones Empresa A + 3 sesiones Empresa B en paralelo)..."
PIDS=()
for i in 1 2 3 4 5; do
  OUT_FILE=$(mktemp)
  SESSION_OUT_FILES+=("$OUT_FILE")
  run_create_po "${U_A}" "${SUP_A}" "${PROD_A}" "${WH_A}" "0" "burst-a-${i}" >"$OUT_FILE" &
  PIDS+=($!)
done
for j in 1 2 3; do
  OUT_FILE=$(mktemp)
  SESSION_OUT_FILES+=("$OUT_FILE")
  run_create_po "${U_B}" "${SUP_B}" "${PROD_B}" "${WH_B}" "0" "burst-b-${j}" >"$OUT_FILE" &
  PIDS+=($!)
done
STEP_RC=0
for pid in "${PIDS[@]}"; do
  wait "$pid" || STEP_RC=$?
done
if [[ "${STEP_RC}" -ne 0 ]]; then
  echo "ERROR: Falló una sesión durante la ráfaga concurrente (rc=${STEP_RC})." >&2
  exit "${STEP_RC}"
fi

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
    INSERT INTO public.purchase_orders (company_id, po_number, supplier_name, status, payment_terms, subtotal, total)
    VALUES ('${CO_A}', 'OC-0006', 'Prov Conc A', 'draft', 'credito', 0, 0);
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
