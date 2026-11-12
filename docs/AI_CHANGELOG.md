# INVENTARIOPRO — HISTORIAL CRONOLÓGICO DE INTERVENCIONES TÉCNICAS (AI CHANGELOG)

> **Documento Oficial Acumulativo de Registro de Cambios**  
> Cada intervención técnica de desarrollo, migración o auditoría debe agregarse al inicio de este documento sin sobrescribir entradas históricas previas.

---

## [2026-11-12] — Fase 2B-2: Corrección Funcional del Formulario Contable Oficial (H-02 y H-03)

- **Fase o tarea:** Fase 2B-2 (Correcciones H-02 Cuentas Imputables y H-03 Tipos de Origen en `JournalEntryForm.tsx`).
- **Problema original:**
  1. El selector de cuentas en las líneas permitía seleccionar cuentas de agrupación o no imputables (`is_postable = false`), lo que ocasionaba un error en el trigger `acc_lines_guard` al intentar guardar.
  2. En el modal del PUC no se identificaban de forma clara las cuentas imputables vs no imputables ni se inhabilitaba la selección de estas últimas.
  3. El selector de módulo de origen ofrecía opciones inválidas (`apertura`, `ventas`, `compras`, `gastos`, `ajustes`), cuando la RPC oficial `acc_create_entry` únicamente admite `'manual'` y `'ajuste'`.
- **Diagnóstico confirmado:**
  - `JournalEntryForm.tsx` no filtraba `is_postable === true` en el `<select>` de líneas.
  - El modal de selección permitía hacer clic sobre cualquier nodo del árbol.
  - El campo `sourceModule` enviaba valores fuera de la restricción `p_source_type in ('manual', 'ajuste')`.
- **Archivos creados, modificados o eliminados:**
  - Modificado: `src/components/JournalEntryForm.tsx`
  - Creados: `docs/PROJECT_CONTEXT.md`, `docs/ACCOUNTING_ARCHITECTURE.md`, `docs/AI_CHANGELOG.md`.
- **Migraciones SQL creadas y estado de aplicación:** Ninguna (fase 100% de frontend y documentación).
- **Cambios realizados en Supabase:** Ninguno.
- **Pruebas ejecutadas y sus resultados:**
  - `npx tsc --noEmit`: 0 errores de tipado.
  - `npm run build`: Compilación limpia de Vite en 4.02s con bundle de producción generado.
  - Verificación de selección:
    - Selector principal filtra cuentas exclusivamente con `active = true` e `is_postable = true`.
    - Modal PUC marca visualmente con badge "Imputable" (verde) y "No imputable" (ámbar).
    - Cuentas no imputables están deshabilitadas (`cursor-not-allowed`, sin acción de clic).
    - Validación pre-envío en `handleSubmit` impide registrar cualquier línea con cuenta no imputable.
    - Selector de origen restringido exclusivamente a `'manual'` (Asiento Manual General) y `'ajuste'` (Ajuste / Reclasificación Contable).
- **Limitaciones o pruebas pendientes:** Ninguna.
- **Commit y hash:** `[Pendiente de commit al finalizar sesión]`
- **Estado final:** ✅ Completada y verificada.

---

## [2026-11-11] — Fase 2B-1: Autorización Controlada de Escritura Contable para el Rol Contador

- **Fase o tarea:** Fase 2B-1 (Resolución del bloqueo de autorización del Contador Público).
- **Problema original:** El usuario con rol `contador` no podía crear borradores ni postear asientos contables a pesar de tener asignado el permiso de la página en `pagePermissions.ts`, recibiendo `ERROR: No autorizado` desde la base de datos.
- **Diagnóstico confirmado:** Las RPC oficiales `acc_create_entry` y `acc_post_entry` estaban protegidas por `if not public.is_manager()`. Dicha función invoca `is_company_manager()`, la cual valida `role IN ('dueno', 'admin_empresa', 'gerente')`, excluyendo por diseño al rol `contador`.
- **Archivos creados, modificados o eliminados:**
  - Creado: `supabase/migrations/20261111000054_autorizacion_escritura_contable.sql`
  - Modificado: `supabase/MIGRATIONS.md`
- **Migraciones SQL creadas y estado de aplicación:**
  - Migración `20261111000054_autorizacion_escritura_contable.sql` **✅ Aplicada** en la base de datos de producción Supabase (`bcwtopujsjefaskoqlhr`) el 2026-11-11 10:38:00 UTC (ID en log: `65648e1a-69d8-4366-9717-f0b2218dba42`).
- **Cambios realizados en Supabase:**
  - Creada la función `public.can_write_accounting()` con `SECURITY DEFINER`, que reconoce perfiles activos con `company_id` y rol en `('dueno', 'admin_empresa', 'gerente', 'contador')`.
  - Actualizada `acc_create_entry` para validar `if not public.can_write_accounting()`.
  - Actualizada `acc_post_entry` para validar `if not public.can_write_accounting()`.
  - `acc_reverse_entry` y `acc_close_period` se mantuvieron estrictamente restringidas a `is_manager()`.
- **Pruebas ejecutadas y sus resultados:**
  - Ejecutada suite automatizada en PostgreSQL con perfiles simulados (`DO $$ ... ROLLBACK $$`):
    - Contador puede crear un borrador en `acc_create_entry` (Aprobado).
    - Contador puede postear un asiento cuadrado en `acc_post_entry` (Aprobado).
    - Contador NO puede reversar asientos en `acc_reverse_entry` (Aprobado: retorna `No autorizado`).
    - Contador NO puede cerrar periodos en `acc_close_period` (Aprobado: retorna `No autorizado`).
    - Contador NO es `is_manager()` (Aprobado: retorna `false`).
    - Vendedor y Cajero no pueden crear asientos (Aprobado: retorna `No autorizado`).
    - Gerente puede reversar asientos (Aprobado).
    - Triggers `acc_entries_guard` y `acc_lines_guard` rechazan asientos descuadrados, cuentas de otra empresa y cuentas no imputables (Aprobado).
- **Limitaciones o pruebas pendientes:** Ninguna en la base de datos.
- **Commit y hash:** `4f88ee7` (`4f88ee79efc440a463d1e66cff4ce2e99d1466dc`)
- **Estado final:** ✅ Completada y verificada.

---

## [2026-11-10] — Fase 1: Conexión Oficial del Formulario Contable con acc_create_entry

- **Fase o tarea:** Fase 1 (Sustitución de cuentas ficticias en memoria y cableado directo a la RPC oficial `acc_create_entry`).
- **Problema original:** El formulario de asientos contables `JournalEntryForm.tsx` utilizaba cuentas PUC falsas en memoria (`SEED_PUC_ACCOUNTS`) con códigos no sincronizados, apuntaba a un endpoint no oficial `/api/accounting/entries` y no utilizaba los UUID reales de `acc_accounts`.
- **Diagnóstico confirmado:** El componente no consumía Supabase directamente y simulaba la persistencia contable, impidiendo que los asientos se registraran en `acc_entries` y `acc_lines`.
- **Archivos creados, modificados o eliminados:**
  - Modificado: `src/components/JournalEntryForm.tsx`
- **Migraciones SQL creadas y estado de aplicación:** Ninguna.
- **Cambios realizados en Supabase:** Ninguno.
- **Pruebas ejecutadas y sus resultados:**
  - Carga en tiempo real de cuentas reales desde `acc_accounts` filtrando por `user?.company_id`.
  - Construcción del payload en formato `jsonb` con 7 parámetros requeridos por `acc_create_entry`.
  - Validación de balance y cálculo de débitos y créditos en tiempo real.
  - `npx tsc --noEmit` y compilación aprobadas.
- **Limitaciones o pruebas pendientes:** Identificados bloqueos de autorización para rol `contador` (resuelto en 2B-1) y selección de cuentas no imputables (resuelto en 2B-2).
- **Commit y hash:** `b8e7c34` (`b8e7c34b655b3ff707beff846b0a688b1f56bb15`)
- **Estado final:** ✅ Completada.

---

## [2026-11-09] — Fase 2A: Auditoría y Limpieza Controlada del Legado Contable

- **Fase o tarea:** Fase 2A (Eliminación de código muerto y paquetes SQL legacy del modelo paralelo `accounts`/`journal_*`).
- **Problema original:** Coexistencia de servicios antiguos (`accountingService.ts`, `useAccounting.ts`), componentes redundantes (`src/components/accounting/JournalEntryForm.tsx`) y paquetes en `src/lib/sqlScripts.ts` que hacían referencia a tablas deprecadas que nunca existieron en la base de datos real.
- **Diagnóstico confirmado:** Ningún componente activo utilizaba los servicios legacy; el único componente válido era `src/components/JournalEntryForm.tsx` (Fase 1).
- **Archivos creados, modificados o eliminados:**
  - Eliminado: `src/services/accountingService.ts`
  - Eliminado: `src/hooks/useAccounting.ts`
  - Eliminado: `src/components/accounting/JournalEntryForm.tsx`
  - Modificado: `src/lib/sqlScripts.ts` (retirado paquete `contable_pro` obsoleto)
  - Modificado: `src/pages/SqlAdminCenter.tsx`
  - Modificado: `src/lib/manualContent.ts`
- **Migraciones SQL creadas y estado de aplicación:** Ninguna.
- **Cambios realizados en Supabase:** Ninguno.
- **Pruebas ejecutadas y sus resultados:**
  - Auditoría de imports/exports demostró 0 referencias activas a los archivos eliminados.
  - `tsc --noEmit` y `npm run build` ejecutados exitosamente con 0 errores.
- **Limitaciones o pruebas pendientes:** Ninguna.
- **Commit y hash:** `6de2f54` (`6de2f546ca3fcae4770a0c2d0f534b60d4a873cc`)
- **Estado final:** ✅ Completada.
