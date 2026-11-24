# Correcciones de auditoría — Contable_Pro

## Orden sugerido

1. SQL Supabase:
   - `01_catalogo_pedidos_antifuerza_bruta.sql`
   - `02_revocar_permisos.sql`

   Cada uno tiene su correspondiente archivo `*_rollback.sql`.

2. GitHub (Upload files, misma ruta):
   - `api/admin-sql.ts`
   - `api/verify-customer-document.ts`
   - `src/pages/SqlAdminCenter.tsx`

3. Variables en Vercel (opcionales, recomendadas):
   - `MASTER_ADMIN_USER_ID`: UUID de sanlobo3@hotmail.com en Authentication > Users.
   - `REQUIRE_MFA=1`: activar solamente después de habilitar MFA en esa cuenta.

4. Dejar de usar `SUPABASE_ACCESS_TOKEN` en Vercel si ya no se necesita.
   La ruta por RPC `admin_ejecutar_migracion_sql` sigue funcionando.

## Qué cambia

- Pedidos de catálogo: 5 fallos por pedido producen un bloqueo de 15 minutos.
- Se utiliza la misma respuesta para pedidos inexistentes y credenciales incorrectas.
- Permisos: `anon` pierde permisos de tabla en 10 tablas.
- `_sale_balance` queda sin permiso EXECUTE para los usuarios.
- `admin-sql`: el diagnóstico `?verify=1` exige sesión de la cuenta maestra.
- La respuesta sin sesión ya no muestra `projectRef`.
- El POST valida el ID, el correo confirmado y el MFA opcional.
- `verify-customer-document`: exige sesión y limita el tamaño de imagen.
- Este archivo sigue sin exportación `default`, por lo que no se expone como ruta API de Vercel.
