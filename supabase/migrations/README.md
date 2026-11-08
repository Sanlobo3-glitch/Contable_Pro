# supabase/migrations

Historial SQL del proyecto. **El estado y las reglas viven en [`../MIGRATIONS.md`](../MIGRATIONS.md)** (no repitas aquí listas de estado: se desactualizan).
Cada archivo debe ser idempotente, sin `BEGIN;`/`COMMIT;` y terminar con el pie `select public.sql_registrar_migracion(...)`.
