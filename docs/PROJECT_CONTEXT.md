# INVENTARIOPRO / CONTABLE PRO — CONTEXTO MAESTRO DEL PROYECTO

> **Documento Oficial de Memoria Técnica y Continuidad**  
> **Repositorio:** `Sanlobo3-glitch/Contable_Pro`  
> **Rama Oficial:** `main`  
> **Última actualización:** 2026-11-13  
> **Estado:** Activo y en producción.

---

## 1. Nombre y Propósito del Proyecto

**InventarioPro** (comercialmente distribuido también como **Contable Pro**) es un ERP SaaS multiempresa de misión crítica diseñado para micro, pequeñas y medianas empresas (MIPYMES) en Colombia y Latinoamérica.

El sistema unifica en tiempo real:
1. **Punto de Venta (POS) y Mostrador:** Venta rápida, facturación fiscal, medios mixtos de pago, turnos y arqueos ciegos.
2. **Fuerza de Ventas y Rutas en Terreno:** Gestión de visitas, pedidos offline, georreferenciación y sincronización móvil.
3. **Gestión de Inventarios Multibodega:** Control de existencias por sucursal, kardex automatizado (promedio ponderado), traslados y toma física ciega.
4. **Ciclo de Compras y Cuentas por Pagar:** Órdenes de compra, recepción con afectación de costos y pasivos a proveedores.
5. **Cartera y Cuentas por Cobrar:** Créditos comerciales, planes separe y control de cobranza.
6. **Contabilidad Regulatoria NIIF y Cumplimiento DIAN:** Partida doble estricta en tiempo real, catálogo PUC oficial, reportes financieros y formatos tributarios (Muisca 300, 350 y Exógena 1001).
7. **Centro de Dirección Gerencial:** Panel ejecutivo, alertas antifraude, planes de acción, evaluaciones de desempeño y autorizaciones de gastos/descuentos.

---

## 2. Arquitectura General del ERP SaaS Multiempresa

### 2.1 Modelo Multitenant
- Toda la base de datos opera bajo el paradigma **multi-tenant con columna `company_id`** (UUID referenciando a `public.companies(id)`).
- **Aislamiento estricto por RLS (Row Level Security):** El 100% de las tablas del esquema `public` posee RLS activo.
- Ninguna transacción puede leer o modificar registros de una empresa distinta a la que pertenece el usuario autenticado.
- La identidad empresarial se ancla en PostgreSQL mediante `auth.uid()` cruzado con `public.profiles(id)` vía `public.my_company()` / `public.current_company_id()`. No se confía jamás en un `company_id` enviado libremente desde el cliente web.

### 2.2 Tecnologías del Stack
- **Frontend:** React 19 SPA, TypeScript, Tailwind CSS, Lucide Icons, Vite.
- **Base de Datos & Auth:** PostgreSQL 15+ administrado en Supabase, Supabase Auth (JWT), Supabase Storage.
- **Lógica de Servidor & Transacciones:** Procedimientos almacenados (RPC en PL/pgSQL) con transacciones ACID, triggers de validación inmutable y funciones con `SECURITY DEFINER` y `search_path` fijado.
- **Despliegue Web:** Vercel (`vite build`).

---

## 3. Arquitectura Contable Oficial: Modelo Exclusivo `acc_*`

### 3.1 Principio Constitucional del Sistema
Está **terminantemente prohibido** crear, utilizar o reintroducir un modelo contable paralelo. La contabilidad del sistema opera exclusivamente bajo las tablas y funciones con prefijo `acc_*`.

### 3.2 Tablas Contables Oficiales
- `acc_accounts`: Catálogo PUC NIIF multiempresa (código, nombre, tipo, naturaleza, `is_postable`, `active`).
- `acc_entries`: Cabecera del libro diario contable (número consecutivo, fecha, descripción, origen, estado `'borrador'`, `'contabilizado'`, `'reversado'`).
- `acc_lines`: Líneas de movimiento contable (cuenta, débito, crédito, memo).
- `acc_periods`: Control de periodos fiscales mensuales (`'abierto'`, `'cerrado'`).
- `acc_closings`: Registro histórico e inmutable de cierres contables mensuales con snapshot de balance.
- `acc_settings`: Parámetros de configuración contable por empresa.
- `acc_counters`: Control de secuencias y consecutivos oficiales de asientos (`diario`, `reverso`).

### 3.3 RPCs Oficiales del Motor Contable
- `acc_create_entry(p_date, p_description, p_lines, p_post, p_source_type, p_source_id, p_event)`
- `acc_post_entry(p_entry_id)`
- `acc_reverse_entry(p_entry_id, p_reason, p_date)`
- `acc_trial_balance(p_from, p_to)`
- `acc_balance_sheet(p_to)`
- `acc_income_statement(p_from, p_to)`
- `acc_ledger(p_account_id, p_from, p_to)`
- `acc_close_check(p_year, p_month)`
- `acc_close_period(p_year, p_month, p_notes, p_ack)`
- `acc_reopen_period(p_year, p_month, p_reason)`
- `acc_seed_template(p_company_id, p_template)`

### 3.4 Inmutabilidad y Triggers de Guardia
- `acc_entries_guard`: Garantiza que todo asiento nace como borrador, valida mínimo 2 líneas, partida doble estricta (`sum(debit) = sum(credit)`), periodo abierto y bloquea modificaciones una vez contabilizado.
- `acc_lines_guard`: Bloquea modificaciones a líneas de asientos contabilizados, garantiza que la cuenta pertenezca a la misma empresa del asiento y exige que la cuenta esté activa y sea imputable (`is_postable = true`).

---

## 4. Roles y Matriz de Responsabilidades

La fuente única de verdad para permisos en la aplicación es `src/lib/pagePermissions.ts` y las funciones de autorización en PostgreSQL:

| Rol | Alcance y Facultades |
|---|---|
| `admin` (SaaS Master) | Administración global de la plataforma, planes, soporte técnico, auditoría y ejecución de migraciones SQL (cuenta maestra `sanlobo3@hotmail.com`). |
| `dueno` | Propietario de la empresa cliente. Acceso completo a todos los módulos de su empresa, pagos de suscripción, configuraciones, cierre contable y apertura de periodos. |
| `admin_empresa` | Administrador general delegado de la empresa cliente. Gestión de usuarios, sucursales, compras, ventas, inventario y contabilidad. |
| `gerente` | Dirección estratégica empresarial (Centro de Dirección Gerencial, reportes ejecutivos, autorizaciones de descuentos/gastos, alertas de caja). No tiene acceso a facturación de plataforma ni a suscripción del dueño. |
| `contador` | Gestión contable profesional: Catálogo PUC NIIF, registro de asientos diarios (`acc_create_entry`), contabilización (`acc_post_entry`), balance de comprobación, estados financieros y Centro Tributario DIAN. **No tiene** permisos gerenciales, ni invitaciones de usuarios, ni reversión de asientos, ni cierre de periodos. |
| `cajero` | Operación de mostrador POS, ventas, apertura/cierre de turno y arqueo ciego de caja. |
| `vendedor` | Ventas en mostrador y ruta asignada, cotizaciones, consulta de clientes y catálogo. Historial restringido exclusivamente a sus propias ventas. Sin acceso a caja. |
| `almacen` | Jefe de bodegas: inventario, traslados, lotes, kardex, toma física y recepción de órdenes de compra. Sin acceso a ventas ni contabilidad. |
| `compras` | Gestión de compras, órdenes de compra y evaluación de proveedores. |
| `transportador` | Logística, despacho de rutas y entrega de pedidos. |

---

## 5. Reglas de Aislamiento y Seguridad RLS

1. **Aislamiento Multi-Tenant Absoluto:**
   - Todo query debe filtrar explícitamente o confiar en políticas RLS basadas en `(company_id = current_company_id())`.
   - Ningún usuario puede ver datos de otra compañía, excepto `admin` global mediante soporte asistido expresamente autorizado (`support_authorizations`).

2. **Funciones Críticas que NO deben modificarse sin auditoría formal previa:**
   - `public.my_company()`
   - `public.current_company_id()`
   - `public.is_platform_admin()`
   - `public.is_company_manager()`
   - `public.is_manager()`
   - `public.can_view_accounting()`
   - `public.can_write_accounting()`
   - `public.acc_entries_guard()`
   - `public.acc_lines_guard()`

3. **Funcionalidades y Esquemas Legacy Eliminados (Prohibido Reintroducir):**
   - Tablas: `accounts`, `journal_entries`, `journal_lines`, `accounting_accounts`, `accounting_entries`, `fn_*`.
   - Servicios frontend: `src/services/accountingService.ts`, `src/hooks/useAccounting.ts`.
   - Componentes legacy: `src/components/accounting/JournalEntryForm.tsx` (reemplazado por `src/components/JournalEntryForm.tsx` oficial).
   - Paquetes SQL descartados: `supabase/migrations_superseded/*`.
   - Semillas en memoria estáticas (cuentas ficticias en frontend).

---

## 6. Fases Completadas y Registro de Commits

| Fase | Commit | Descripción Resumida |
|---|---|---|
| **Fase 1** | `b8e7c34` | Conexión del formulario oficial `JournalEntryForm.tsx` a cuentas reales desde `acc_accounts` (UUIDs) y a la RPC `acc_create_entry`. Eliminación total de cuentas ficticias en frontend. |
| **Fase 2A** | `6de2f54` | Limpieza controlada del legado contable: eliminación de `accountingService.ts`, `useAccounting.ts`, formulario legacy `accounting/JournalEntryForm.tsx` y limpieza de scripts SQL legacy. |
| **Fase 2B-1** | `4f88ee7` | Autorización controlada de escritura contable para el rol `contador`: creación de `public.can_write_accounting()` y actualización de `acc_create_entry` y `acc_post_entry` en Supabase (Migración `20261111000054`). |
| **Fase 2B-2** | `12ec46c` | Corrección funcional en `JournalEntryForm.tsx`: restricción de selección exclusivamente a cuentas con `is_postable = true`, identificación y bloqueo de cuentas no imputables en modal PUC, y restricción de `sourceModule` exclusivamente a `'manual'` y `'ajuste'`. |
| **Fase 3** | `af6ff8a` | Blindaje del ciclo comercial, caja y contabilización automática NIIF (`20261113000061`): corrección `warehouses.active` en `caja_abrir_turno`, endurecimiento `search_path`/`anon` en RPCs de caja y contabilización, soporte de `sale_payments` en `acc_post_sale` y cartera (`_sale_balance`, `_customer_owed`, `cartera_*`, `registrar_abono`), creación de `registrar_venta_multipago` ACID, UI Multipago en `Mostrador.tsx`, cola offline y arqueo autoritativo en `CashShiftModal.tsx`. |

---

## 7. Decisiones Técnicas Vigentes y Convenciones

1. **Gestión de Migraciones:**
   - Todo cambio de base de datos se guarda en `supabase/migrations/AAAAMMDDNNNNNN_nombre.sql`.
   - Sin bloques `BEGIN;`/`COMMIT;` dentro del archivo.
   - Debe ser estrictamente idempotente.
   - Debe finalizar con `select public.sql_registrar_migracion(...)`.
   - Debe documentarse de inmediato en `supabase/MIGRATIONS.md`.

2. **Permisos y Navegación:**
   - La tabla centralizada es `src/lib/pagePermissions.ts`. No definir reglas de rol sueltas en componentes aislados.

3. **Zona Horaria:**
   - Operaciones en Colombia (UTC-5). Toda manipulación de fecha contable debe usar la fecha local (`YYYY-MM-DD`) evitando saltos de fecha por conversión UTC desfasada.
