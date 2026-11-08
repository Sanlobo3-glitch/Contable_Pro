-- ============================================================================
-- 20261107000050 · Quitar la sobrecarga antigua de admin_ejecutar_migracion_sql (ya aplicada el 2026-11-07)
-- Existían DOS versiones: (text,text,text) sin el arreglo de BEGIN;/COMMIT; y (text,text,text,text) con él.
-- La app llama con 3 parámetros con nombre; con ambas presentes el resultado era ambiguo.
-- La versión de 4 parámetros tiene p_migration_file con valor por defecto, así que cubre las llamadas de 3.
-- ============================================================================
drop function if exists public.admin_ejecutar_migracion_sql(text, text, text);

do $reg$
begin
  if to_regprocedure('public.sql_registrar_migracion(text,text,text,text,text)') is not null then
    perform public.sql_registrar_migracion('20261107000050_quitar_sobrecarga_admin_ejecutar_migracion_sql', 'Quitar sobrecarga antigua del motor SQL', '20261107000050_quitar_sobrecarga_admin_ejecutar_migracion_sql.sql');
  end if;
end
$reg$;
