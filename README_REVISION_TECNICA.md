# Paquete de Revisión Técnica — Contable_Pro (Migración 69: Conciliación Bancaria Manual)

Este paquete reúne los 11 archivos vigentes del módulo de **Conciliación Bancaria Manual** para revisión del equipo técnico.

## Estado importante
- **Base de datos viva:** Migración 69 (`20261119000069_conciliacion_bancaria_manual.sql`) **NO aplicada aún** (pendiente de ejecución en base de pruebas/staging).
- **Migraciones 63–68:** Intactas y sin re-ejecutar.
- **Modalidad:** Conciliación bancaria **100% manual** (sin sincronización bancaria automática, sin cruces automáticos y sin generación automática de asientos contables).

## Archivos incluidos
1. `supabase/migrations/20261119000069_conciliacion_bancaria_manual.sql`
2. `supabase/tests/conciliacion_bancaria_manual_rollback_tests.sql`
3. `src/services/bankReconciliationService.ts`
4. `src/pages/BankReconciliation.tsx`
5. `src/lib/supabase.ts`
6. `src/lib/auth.tsx`
7. `src/lib/pagePermissions.ts`
8. `src/lib/sqlScripts.ts`
9. `src/pages/SqlAdminCenter.tsx`
10. `supabase/MIGRATIONS.md`
11. `docs/PERMISOS_POR_ROL.md`

## Correcciones obligatorias incorporadas
1. Aislamiento multiempresa estricto (`company_id`) en cuentas bancarias, extractos, movimientos, cruces, asientos (`acc_entries`), líneas (`acc_lines`) y cuentas contables (`acc_accounts`).
2. Emparejamiento independiente del orden de identificadores y validado por naturaleza contable vs. signo bancario.
3. Bloqueo estricto sobre extractos confirmados (`confirmed_at IS NOT NULL`, incluso en estado `parcialmente_conciliado` o `con_diferencia`) hasta reapertura formal autorizada.
4. `bank_statement_summary` acotado estrictamente a la empresa activa.
5. Sustitución de `count(*) + 1` por contador atómico `public.bank_statement_counters` con bloqueo de fila y control de unicidad.
6. Preservación intacta de `public._require_company_roles(text[])` y `public._es_finito(numeric)` mediante helpers locales del módulo bancario.
7. Validación de fechas dentro de `[period_start, period_end]`, `<= cutoff_date` y períodos contables abiertos (`acc_period_is_open`).
8. Bloqueo de doble confirmación sin reapertura previa.
9. Inmutabilidad de `bank_reconciliation_events` frente a `UPDATE`/`DELETE` con trigger dedicado.
10. Políticas RLS explícitas y nombradas (sin bucles genéricos sobre `pg_policies`), manteniendo SELECT + `support_read_*`.
11. Separación granular de permisos en 6 capacidades (lectura, administración de cuentas, captura, conciliación/confirmación, anulación y reapertura formal).
12. Paridad en modo demostración dentro de `src/lib/supabase.ts`.

## Siguiente paso recomendado para el equipo técnico
Ejecutar en una base PostgreSQL / Supabase de pruebas (no producción):
1. Revisar y aplicar `supabase/migrations/20261119000069_conciliacion_bancaria_manual.sql`.
2. Ejecutar `supabase/tests/conciliacion_bancaria_manual_rollback_tests.sql` (envuelto en `BEGIN; ... ROLLBACK;`) con roles reales `anon` y `authenticated`.
