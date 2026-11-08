# Instrucciones para agentes de IA

Antes de tocar el proyecto lee, en este orden: `README.md` → `supabase/MIGRATIONS.md`.

Reglas no negociables:
- Contabilidad = modelo `acc_*`. No crear `accounts`, `journal_entries`, `journal_lines` ni funciones `fn_*`.
- No afirmes que una migración está "aplicada" sin comprobarlo en `public.sql_migration_log` o en la base.
- Todo SQL nuevo: archivo idempotente en `supabase/migrations/` (sin BEGIN/COMMIT) + pie `select public.sql_registrar_migracion(...)` + fila en `supabase/MIGRATIONS.md`.
- No dejes README/LEEME con estados que no verificaste; actualiza `MIGRATIONS.md` y borra lo obsoleto.
- Si cambias `src/lib/sqlScripts.ts`, lista todas las tablas del paquete en `targetTables`.
