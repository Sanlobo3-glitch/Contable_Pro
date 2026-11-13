-- La _350 usaba acc_entries.date (no existe); la columna real es entry_date.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dian_calcular_formulario_350(uuid,timestamptz,timestamptz)'::regprocedure);
  d := replace(d, 'e.date >= p_start_date::date and e.date < p_end_date::date', 'e.entry_date >= p_start_date::date and e.entry_date < p_end_date::date');
  execute d;
end $$;

select public.sql_registrar_migracion(
  '20261112000059_corregir_columna_fecha_formulario_350',
  'Corregir e.date por e.entry_date en dian_calcular_formulario_350',
  '20261112000059_corregir_columna_fecha_formulario_350.sql'
);
