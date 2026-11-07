# AGENTS.md — Contexto operativo de InventarioPro (Contable Pro)

> **Lee este archivo completo antes de tocar nada.** Está escrito para que una IA (o una persona)
> que entra por primera vez entienda el proyecto en minutos, sin tener que reconstruir el
> estado real de la base de datos a base de leer 77 páginas y 42 librerías.
>
> Última verificación contra la base de datos real: **2026-11-07**. Los datos de este documento
> son verificables; si algo contradice al código, el código manda, pero avisa y actualiza aquí.

---

## 0. TL;DR — las 9 cosas que hay que saber

1. **Las migraciones se aplican A MANO** desde el SQL Editor de Supabase. **Nunca** uses
   `supabase db push`: el historial de la BD usa timestamps del Dashboard, no los nombres de
   archivo del repo, así que el CLI cree que *nada* está aplicado y lo reintenta todo.
2. **El flujo de venta ya está bien.** Es un RPC transaccional (`registrar_venta`) con
   `FOR UPDATE`, no inserts sueltos. Hay una lista de "bugs" circula en documentos antiguos
   que **ya están arreglados** — no vuelvas a "arreglarlos".
3. **La bitácora de SQL** vive en `public.sql_migration_log` y desde la migración `000049`
   guarda el SQL exacto, su hash, el error, la duración, el origen y el archivo asociado.
4. **`supabase/migrations_superseded/` contiene 3 archivos "NO ejecutar"** que además están
   copiados dentro de `supabase/migrations/`. Borrar esas copias (tarea pendiente).
5. **Linux es case-sensitive**: `reportUtils.ts`, no `ReportUtils.ts`.
6. **Copia siempre desde la pestaña "Code" de GitHub**, nunca desde una vista renderizada
   (se cuelan nodos `<!---->` de React y rompen el build).
7. **No hay tests en el repo.** `npm run build` **no** corre `tsc`; el type-check va aparte.
8. **Las credenciales NO están en el repo** (`.env*` está en `.gitignore`). Hay que pedirlas.
9. **El deploy de Vercel está muerto** (`DEPLOYMENT_NOT_FOUND`) y su URL está hardcodeada en
   `index.html`, `public/sitemap.xml` y `public/robots.txt`.

---

## 1. Qué es el proyecto

**InventarioPro** (nombre interno: *Contable Pro*) es un SaaS **multiempresa** de gestión de
negocios: inventario, ventas, compras, caja, devoluciones, rutas de reparto, catálogo digital,
nómina, soporte técnico y **contabilidad de partida doble**.

Cada fila de negocio lleva `company_id` y el aislamiento se aplica con **Row Level Security**
(RLS) + el contexto de empresa (`public._ctx()`), no con `WHERE company_id = ...` en el cliente.

---

## 2. Stack y comandos

| Capa | Tecnología |
|---|---|
| Front | React 19 + TypeScript ^7 + Vite 8 + Tailwind 4 |
| Datos | TanStack Query 5 + `@supabase/supabase-js` 2.119 |
| Servidor | **Bun** (`server.ts`, Express) + funciones serverless en `api/` (Vercel) |
| extras | `lucide-react`, `jspdf` + `jspdf-autotitle`… (`jspdf-autotable`), `xlsx`, `@google/genai` |
| Base de datos | Supabase (PostgreSQL 17) |

```bash
npm install          # hay que instalarlo: node_modules no está en el repo
npm run dev          # bun --watch server.ts  (servidor con API)
npm run build        # vite build            (NO corre tsc)
npm run lint         # tsc --noEmit          (el type-check va aquí)
npm run start        # bun server.ts
```

> `build` es `vite build` pelado. Si quieres type-check + build, corre `npm run lint && npm run build`.
> **No hay ningún framework de tests**: no busques `*.test.ts`, no existen.

---

## 3. Estructura del repositorio

```
src/
  pages/       77 páginas (una por módulo: Sales, Purchases, Cash, Accounting, Reports, …)
  components/  ~40 componentes (accounting/ tiene los de contabilidad)
  lib/         42 módulos: auth.tsx, supabase.ts, offlineQueue.ts, reportUtils.ts, tax.ts, …
  services/    capa de servicios (mezcla .ts y .tsx)
  hooks/       useAccounting.ts
  types/       tipos compartidos (Product, Customer, Supplier, Sale, KardexEntry…)
  assets/      imágenes estáticas
api/           5 funciones serverless de Vercel:
                 accounting.ts, admin-sql.ts, copilot.ts,
                 document-scanner.ts, store-preview.ts
supabase/
  migrations/          77 archivos .sql (se aplican A MANO)
  migrations_superseded/  3 archivos "NO ejecutar" (y duplicados dentro de migrations/)
  audits/              2 scripts de auditoría (00 y 01)
```

### El archivo más importante del repo

`src/lib/supabase.ts` (~7.500 líneas) contiene **dos implementaciones en un solo archivo**:

- el cliente real de `@supabase/supabase-js`, y
- un **mock completo en memoria** de toda la aplicación, que se activa cuando **no** hay
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.

Cuando toques algo que pase por Supabase, **actualiza también el mock** (los `case '...'` del
`switch` de RPC y `getTable('...')`), o el modo demo se rompe silenciosamente.

---

## 4. Base de datos real (estado verificado)

| | |
|---|---|
| Project ref | `bcwtopujsjefaskoqlhr` |
| Nombre | `Contable_pro` |
| Región | `us-west-2` · PostgreSQL `17.6.1.147` |
| Estado | `ACTIVE_HEALTHY` |
| Objetos | **84 tablas**, **199 policies**, **270 funciones** en `public` |
| Datos | 5 empresas · 5 usuarios Auth · 29 ventas · 48 kardex · 28 asientos de caja |

### Tablas de negocio (todas con `company_id`)

`sales`, `purchases`, `cash_entries`, `devolutions`, `kardex`, `products`, `customers`,
`suppliers`, `company_config`, `companies`, `branches`, `warehouses`, `product_images`,
`catalog_orders`, `financial_budgets`, `purchase_orders`, `expenses`, `lots`, `quotations`,
`visits`, `member_profiles`, `profiles`.

### Contabilidad (esquema vigente `acc_*`)

`acc_accounts` · `acc_entries` · `acc_lines` · `acc_periods` · `acc_closings` · `acc_settings` ·
`acc_counters`, con funciones `acc_post_sale`, `acc_post_cash`, `acc_post_expense`,
`acc_post_purchase`, `acc_trial_balance`, `acc_balance_sheet`, `acc_income_statement`,
`acc_reconcile`, `acc_close_period`, `acc_reopen_period`, `acc_reverse_entry`, `acc_seed_template`…

### Tablas de plataforma / soporte / auditoría

`platform_staff`, `platform_admin_audit`, `support_tickets`, `support_authorizations`,
`support_access_audit`, `audit_log`, `sql_migration_log`.

### RPC que importan

| RPC | Para qué |
|---|---|
| `registrar_venta` | venta normal (transaccional, idempotente por `client_uuid`) |
| `registrar_venta_bodega` | venta con bodega (inventario multibodega) |
| `anular_venta` | reversa stock, kardex, caja, lotes y marca la venta `anulada` |
| `registrar_compra` / `registrar_abono` / `registrar_devolucion` / `registrar_gasto` | operaciones |
| `registrar_visita` | visita con GPS |
| `ajustar_stock`, `reserve_warehouse_stock`, `recibir_orden_compra` | inventario |
| `acc_trial_balance`, `acc_reconcile` |motor contable y conciliación |
| `admin_ejecutar_migracion_sql` | motor SQL de 1 clic (solo cuenta maestra) |
| `admin_registrar_ejecucion_sql` | registrar ejecución/fallo en la bitácora (solo cuenta maestra) |
| `registrar_ejecucion_sql` | registro de bitácora técnico (solo `service_role`) |

---

## 5. El flujo de venta — YA ESTÁ BIJO, NO LO "ARREGLES"

El punto de entrada es `src/pages/Sales.tsx` → `enqueueSale()` en `src/lib/offlineQueue.ts`
(permite cola offline) → `supabase.rpc('registrar_venta', …)`.

`public.registrar_venta` es `SECURITY DEFINER` con `search_path` fijado y hace, **en una sola
transacción**:

- `SELECT … FOR UPDATE` sobre `products` y sobre `customers` (bloqueo de filas ⇒ sin stock stale);
- valida stock y lotes (`_lot_consume`), descuenta y **relee** el stock;
- inserta la venta en `sales` y el movimiento en `kardex` con `balance = v_new` (el stock recién
  calculado, no el anterior);
- inserta en `cash_entries` **solo si el método de pago es `efectivo`**;
- fija `company_id` con `public._ctx(null)`;
- es idempotente por `client_uuid`.

`public.anular_venta` revierte: `products.stock += qty`, kardex tipo `entrada`, un `egreso` en
`cash_entries` por el mismo importe, restauración de lotes (`_lot_restore`) y `status = 'anulada'`.

> Documentos antiguos del repo (`supabase/migrations/README.md`, auditorías previas) listan
> "bugs" de este flujo: caja inflada, stock stale, ausencia de transacción, anulación sin
> reversión y `company_id` ausente. **Los cinco están resueltos** y verificados en la BD.
> No los vuelvas a arreglar ni a "mejorar" sin evidencia nueva.

---

## 6. Migraciones: se aplican A MANO

**Regla de oro: nada de `supabase db push`.**

El README de `supabase/migrations/` documenta el procedimiento real: pegar cada `.sql` en
**Supabase → SQL Editor → Run**, en el orden indicado (1→5 del "Centro de Control").

El motivo técnico: la tabla `supabase_migrations.schema_migrations` guarda el `version` como
**timestamp del Dashboard** (p. ej. `20261107040250`), no el prefijo del nombre de archivo
(p. ej. `20261107000048_…`). El campo `name` sí conserva el nombre original. Por eso:

```sql
-- Estado real de las migraciones aplicadas
select version, name, created_by, created_at
from supabase_migrations.schema_migrations
order by version desc;
```

Además, **3 de los nombres de archivo del repo no son válidos para el CLI** (prefijo de 8
dígitos con guion: `20261029_2130_…`, `20261101_…`, `20261102_…`).

### Las 3 migraciones "superseded" — NO ejecutar

`supabase/migrations_superseded/` contiene (con su propio README que lo explica):

- `20261106000022_contable_pro_partida_doble_puc_niif.sql`
- `20261106000046_sistema_contable_partida_doble.sql`
- `20261106000047_reportes_financieros_contables.sql`

Crean un **segundo libro contable** (`accounts`, `journal_entries`, `fn_*`) paralelo al vigente
(`acc_*`), que **nunca se aplicó**. Ejecutarlas duplicaría el libro.

> ⚠️ **Pendiente conocido:** esos mismos 3 archivos están **también** dentro de
> `supabase/migrations/`. Si alguien corre `supabase db push`, se aplican y se duplica el
> libro contable. **Fix:** borrar las copias de `supabase/migrations/`.

---

## 7. Bitácora de SQL (`migración 000049`)

Tabla: `public.sql_migration_log`. Antes solo guardaba `script_id`, `status` y la *longitud* del
SQL. Desde `20261107000049_bitacora_sql_ejecucion_manual.sql` guarda además:

| Columna | Contenido |
|---|---|
| `sql_text` | el SQL exacto que se ejecutó (truncado a 200 000 caracteres) |
| `sql_hash` | SHA-256 del SQL → detecta si un script cambió entre ejecuciones |
| `error_message` | mensaje de error cuando `status = 'error'` |
| `duration_ms` | duración de la ejecución |
| `source` | `app_rpc` · `management_api` · `sql_editor` · `api` |
| `migration_file` | archivo `.sql` del repo al que corresponde |
| `result_rows` | filas devueltas |

Estado actual: **63 registros** (56 migraciones reconstruidas + 7 ejecuciones previas).

### Cómo se registra

| Camino | Éxito | Error |
|---|---|---|
| `api/admin-sql.ts` (Management API) | ✅ en el propio handler | ✅ en una consulta aparte |
| `api/admin-sql.ts` → fallback RPC | ✅ lo registra el RPC | ✅ en una consulta aparte |
| RPC directo desde la UI | ✅ lo registra el RPC | ✅ lo registra la UI |

> **Por qué el error se registra aparte:** cuando una sentencia falla, PostgreSQL aborta la
> transacción **completa**, así que un `INSERT` de bitácora hecho dentro del mismo `RAISE` se
> pierde. Por eso el fallo se registra en una **transacción independiente** (la del cliente).
> No "simplifiques" esto moviéndolo dentro del `EXCEPTION` handler: dejó de funcionar.

### Consultas útiles

```sql
-- Todo lo aplicado, con su SQL
select executed_at, source, status, script_id, migration_file, statements_length
from public.sql_migration_log
order by executed_at desc;

-- Solo fallos
select executed_at, script_id, error_message
from public.sql_migration_log
where status = 'error'
order by executed_at desc;

-- Scripts cuyo SQL cambió respecto a la última ejecución
select script_id, count(distinct sql_hash) hashes, max(executed_at)
from public.sql_migration_log
where sql_hash is not null
group by script_id
having count(distinct sql_hash) > 1;
```

---

## 8. Trampas conocidas

| # | Trampa | Qué hacer |
|---|---|---|
| 1 | `supabase db push` | **Nunca.** Aplica todo dos veces y crea el libro contable duplicado |
| 2 | 3 archivos *superseded* duplicados en `migrations/` | No los ejecutes; bórralos de ahí |
| 3 | Linux es case-sensitive | `reportUtils.ts` (no `ReportUtils.ts` / `ReportUtil.ts`) |
| 4 | Copiar desde una vista renderizada | Copia desde la pestaña **Code**; si no, mete nodos `<!---->` y rompe el build (TS1003/TS1382) |
| 5 | Archivos grandes en GitHub web | Usa **Add file → Upload files** (arrastrar el adjunto): sube los bytes exactos |
| 6 | `src/lib/supabase.ts` tiene mock **y** cliente real | Actualiza ambos al tocar algo de datos |
| 7 | `npm run build` no type-checkea | Corre `npm run lint` aparte |
| 8 | `SUPABASE_URL` con `/rest/v1/` al final | El repo lo normaliza (`normalizeSupabaseUrl`), pero el SDK espera la base. Usa `https://<ref>.supabase.co` |
| 9 | La URL de Vercel hardcodeada está muerta | `contable-pro-zeta.vercel.app` → `DEPLOYMENT_NOT_FOUND` |
| 10 | `anon` no tiene permisos de lectura | En tablas de negocio solo entra `authenticated`; `anon` da 401/42501 — es el diseño, no un fallo |

---

## 9. Seguridad y cuentas

- **Cuenta maestra de SQL**: `sanlobo3@hotmail.com` (constante `MASTER_DEV_EMAIL` en
  `src/lib/auth.tsx` y `MASTER_ADMIN_EMAIL` en `api/admin-sql.ts`). Única autorizada para
  ejecutar SQL y para leer la bitácora.
- `api/admin-sql.ts` verifica el JWT contra `/auth/v1/user` **y** contrasta el email antes de
  ejecutar nada. El token de Management API **nunca** viaja al cliente.
- `admin_ejecutar_migracion_sql` y `admin_registrar_ejecucion_sql` repiten la comprobación
  dentro de la función (`profiles.role = 'admin'` + email de la cuenta maestra).
- Roles de negocio: `admin`, `dueno`, `admin_empresa`, `gerente`, `contador`, `almacen`,
  `comprador`, `cajero`, `vendedor`, `transportador`, `tecnico`.
- `isReadOnly(user)` (en `src/lib/auth.tsx`) bloquea la operación si la suscripción está vencida.

### Credenciales

**No están en el repo.** `.gitignore` excluye `.env*` (solo existe `.env.example` con
placeholders vacíos). Si necesitas operar la BD, pídeselas al propietario y guárdalas cifradas
en el almacén de secretos; **nunca** las escribas en un archivo del repo.

---

## 10. Estado real y pendientes

### Hecho y verificado
- Arquitectura multiempresa con RLS en 84 tablas y 199 policies.
- Flujo de venta transaccional con bloqueo de filas e idempotencia.
- Contabilidad de partida doble con `acc_*`, cierre/reapertura de periodos y estados financieros.
- Motor SQL de 1 clic desde la web con verificación de cuenta maestra.
- Bitácora con trazabilidad completa y reconstrucción del historial (migración `000049`).

### Pendiente real
1. **Auditoría de seguridad a medias.** `supabase/migrations/README.md` documenta una entrega
   con scripts `00`→`99` y declara el cierre en "03, 05, 06 y 09 aplicados + pruebas + revisión
   manual". **Los archivos no están en el repo** (en `supabase/audits/` solo hay `00` y `01`).
   Hallazgos abiertos: aislamiento de `customer_locations`, validación del vendedor en
   `guardar_meta`, unicidad de asiento por documento/evento y bloqueo en `acc_system_entry`.
2. **Borrar las 3 copias *superseded*** de `supabase/migrations/`.
3. **Desplegar** y arreglar las URLs hardcodeadas (`index.html`, `sitemap.xml`, `robots.txt`).
4. **Rotar credenciales expuestas**: el PAT clásico de GitHub (scope `repo`) y el
   `SUPABASE_ACCESS_TOKEN` de Management API están pegados en un chat: dar de baja y sustituir
   por equivalentes de privilegio mínimo (fine-grained `contents:write` / token de sólo lectura
   para consultas).
5. **Sin tests.** No hay red de seguridad ante regresiones en el motor contable.
6. **Deuda menor documentada**: `anular_compra` no restaura el costo anterior del producto;
   códigos de invitación de 8 hex (riesgo bajo); zonas horarias por defecto mezcladas
   (`America/Bogota` vs `America/Caracas`); `push_subscribe` reasigna suscripción si conoce el
   endpoint.

---

## 11. Cómo trabajar en este repo

1. **Lee este archivo** y `supabase/migrations/README.md` antes de tocar la BD.
2. **Verifica contra la BD real**, no contra el código: el código puede mentir (por eso el
   `src/lib/supabase.ts` tiene un mock). Usa el SQL Editor o el Management API.
3. **Cambios de esquema** → un `.sql` nuevo en `supabase/migrations/`, numerado
   `AAAAMMDDNNNNN_descripcion.sql`, **idempotente** (`IF NOT EXISTS`, `IF EXISTS`, `DO $$`),
   y aplícalo a mano.
4. **Una migración = una versión en el repo.** Si aplicas algo por SQL Editor y no existe como
   archivo, créalo en el repo; si existe, actualiza el archivo con lo que realmente se aplicó.
5. **Todo SQL ejecutado desde la app queda registrado.** Si añades una vía nueva de ejecución,
   llámala por `registrar_ejecucion_sql` / `admin_registrar_ejecucion_sql` en una transacción
   aparte para que los fallos también queden.
6. **Nada de secretos en el repo.** Ni en código, ni en `.env` versionado, ni en logs.
7. **Si tocas el mock**, toca también el cliente real y al revés. Comprueba con
   `npm run lint && npm run build`.
