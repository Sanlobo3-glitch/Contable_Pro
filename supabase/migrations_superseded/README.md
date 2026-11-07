# Migraciones reemplazadas (NO ejecutar)

Estas tres migraciones crean un segundo libro contable (`accounts`, `journal_entries`,
`journal_lines` y las funciones `fn_*`) que **nunca se aplicó** en Supabase.

El modelo contable vigente es `acc_*` (`acc_accounts`, `acc_entries`, `acc_lines`, `acc_periods`,
`acc_closings`, `acc_settings`) con sus funciones `acc_*`. Ya incluye partida doble, inmutabilidad
(`acc_entries_guard`, `acc_lines_guard`), cierre de libros y estados financieros.

Se conservan aquí solo como historial. Ejecutarlas crearía un libro paralelo y duplicado.
