-- Quita EXECUTE a anon/PUBLIC en funciones que solo usan usuarios con sesión.
revoke execute on function public.dian_calcular_formulario_300(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.dian_calcular_formulario_350(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.contabilizar_venta_automatica(uuid) from public, anon;
revoke execute on function public.registrar_pagos_venta(uuid, jsonb, uuid) from public, anon;

select public.sql_registrar_migracion(
  '20261112000057_cerrar_anon_funciones_sensibles',
  'Cerrar acceso anon a funciones DIAN y contables',
  '20261112000057_cerrar_anon_funciones_sensibles.sql'
);
