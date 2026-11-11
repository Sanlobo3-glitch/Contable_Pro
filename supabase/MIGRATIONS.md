# MIGRACIONES Y ESTADO DE LA BASE DE DATOS — fuente única de verdad

> Actualizado: **2026-11-11**. Proyecto Supabase **Contable_pro** (`bcwtopujsjefaskoqlhr`, us-west-2). Producción: `contable-pro-zeta.vercel.app`.
> Si algo de otro documento contradice este archivo, **este archivo y la tabla `public.sql_migration_log` mandan**.

## 1. Lee esto primero (reglas para cualquier IA o persona)

1. **Un solo libro contable: `acc_*`** (`acc_accounts`, `acc_entries`, `acc_lines`, `acc_periods`, `acc_closings`, `acc_settings`, `acc_counters` y funciones `acc_*`).
   Ya tiene partida doble, inmutabilidad (`acc_entries_guard`, `acc_lines_guard`), cierre de periodos y estados financieros.
   **NO crear ni usar** las tablas `accounts`, `journal_entries`, `journal_lines` ni funciones `fn_*` contables: nunca existieron en la base. Sus migraciones están en `supabase/migrations_superseded/` solo como historial.
2. **No confíes en README/LEEME antiguos.** Estado real = este archivo + `select * from public.sql_migration_log order by executed_at desc;`.
3. **Antes de crear una migración**, revisa la sección 4 y la bitácora; no dupliques objetos que ya existen.
4. **Toda migración nueva termina con el pie de registro** (sección 5) y se agrega a la tabla de la sección 4 en el mismo cambio.
5. **Una migración = un archivo `.sql`** en `supabase/migrations/`, sin `BEGIN;`/`COMMIT;` propios (el Centro SQL y Supabase ya envuelven la transacción) y **idempotente** (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`).
6. Cuenta maestra de la plataforma: `sanlobo3@hotmail.com`. Solo ella ejecuta SQL desde el Centro SQL de la app.
7. Seguridad: todas las tablas de `public` tienen RLS. Las funciones `SECURITY DEFINER` fijan `search_path`. No dar privilegios a `anon` salvo el catálogo público.

## 2. Cómo se registra TODO lo que se ejecuta (3 caminos, un solo registro)

Registro = tabla `public.sql_migration_log` (columnas clave: `script_id`, `migration_file`, `status`, `source`, `executed_at`, `executed_email`).

| Cómo se ejecutó | Cómo queda registrado |
|---|---|
| Desde la app (Centro SQL → Aplicar) | Automático por `admin_ejecutar_migracion_sql` (`source = app_rpc`). |
| Pegado en el SQL Editor de Supabase | El **pie del archivo** llama a `sql_registrar_migracion(...)` (`source = sql_editor_manual`). Los paquetes del Centro SQL ya traen el pie. |
| Ejecutado a mano **sin** pie | Botón **«Ya la ejecuté a mano · registrar»** del Centro SQL (`source = app_manual`). |
| Migraciones anteriores al registro | Relleno verificado el 2026-11-07 (`source = backfill_verificado`). |

Funciones del registro (todas en `public`):
- `registrar_ejecucion_sql(...)` (interna) y `admin_registrar_ejecucion_sql(...)` (registra un fallo desde el cliente): definidas en `20261107000040_bitacora_sql_trazabilidad_base.sql`.
- `sql_registrar_migracion(script_id, title, file, source, summary)` → idempotente; solo `postgres`/`service_role`.
- `admin_registrar_migracion_manual(script_id, title, file, summary)` → solo cuenta maestra.
- `admin_estado_objetos(tablas[], funciones[])` → estado real de objetos + lo registrado; lo usa el Centro SQL para marcar «Activo» o «Listo para aplicar».
- `admin_ejecutar_migracion_sql(sql, id, título, archivo)` → motor (**una sola versión**, de 4 parámetros; la de 3 se eliminó en `…000050`); ignora `BEGIN;`/`COMMIT;` sueltos (antes fallaba con `0A000 EXECUTE of transaction commands is not implemented` en paquetes con varios archivos).
- `sql_migration_log` solo se **lee** desde la app (sin INSERT/UPDATE/DELETE/TRUNCATE para `authenticated`).

## 3. Modelo contable vigente (`acc_*`) y estado de la consolidación

- Pantallas que lo usan: `AccountantDesk`, `AccountingSetup`, `AccountingClose`, `AccountingStatements`, `Accounting` (catálogo + «Registrar Asiento Diario»), `ErpBridge`, `Cartera`, `Expenses`, `Payables`, `CommandCenter`.
- Crear asiento: RPC `acc_create_entry(p_date, p_description, p_lines jsonb [{account_id, debit, credit, memo}], p_post, p_source_type 'manual'|'ajuste', p_source_id, p_event)`. Numeración y periodo abierto los valida la base.
- Reportes: `acc_trial_balance(p_from, p_to)`, `acc_balance_sheet(p_to)`, `acc_income_statement(p_from, p_to)`.
- Migración 48 retiró `get_trial_balance` y `verify_journal_entry_balance` (apuntaban a tablas inexistentes), un índice duplicado en `sales` y creó índices para todas las claves foráneas (`idx_fk_*`).

## 4. Migraciones del repositorio (`supabase/migrations/`)

Resultado de la verificación contra la base (2026-11-07): **todas las migraciones aplicadas** salvo las marcadas.

| # | Archivo | Estado | Nota |
|---|---|---|---|
| 1 | `20261029_2130_registrar_venta_pago_mixto.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 2 | `20261029_2131_baseline_registrar_visita.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 3 | `20261029_2132_baseline_registrar_abono.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 4 | `20261101000003_roles_y_admins.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 5 | `20261101000004_permisos_contabilidad.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 6 | `20261101000005_sucursales_y_bodegas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 7 | `20261101000006_inventario_multibodega.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 8 | `20261101000007_kardex_movimientos.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 9 | `20261101_cuentas_por_pagar.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 10 | `20261101_gastos_y_devoluciones_completas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 11 | `20261101_mejoras_compras_costo_promedio.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 12 | `20261101_vendedores_nomina_invitaciones_usuarios.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 13 | `20261102000008_traslados_bodegas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 14 | `20261102000009_recepcion_parcial_traslados.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 15 | `20261102000010_reservas_inventario.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 16 | `20261102000011_inicializar_bodegas_inventario.sql` | ✅ Aplicada | Inicializa datos (sucursal principal). Verificada por datos: 4 de 5 empresas la tienen (la 5.ª se creó después). |
| 17 | `20261102000012_ventas_por_bodega.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 18 | `20261102_liquidacion_nomina_despacho_rutas_catalogo_digital.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 19 | `20261102_seguridad_multidispositivo.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 20 | `20261102_seguridad_roles_empresa.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 21 | `20261103000013_tesoreria_centros_costo_ordenes_compra.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 22 | `20261103000014_presupuesto_maestro_storage_imagenes_catalogo_vendedor.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 23 | `20261103000015_tabla_imagenes_productos_y_sincronizacion_pos.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 24 | `20261103000016_rol_tecnico_soporte_sesiones_y_contador.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 25 | `20261103000017_centro_administracion_sql_supabase.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 26 | `20261103000018_ventas_catalogo_variantes_pagos_identidad.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 27 | `20261103000019_enlace_tienda_og_y_estudio_whatsapp.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 28 | `20261103000020_sincronizacion_automatica_marca_y_cache_whatsapp.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 29 | `20261104000021_cinco_soluciones_comerciales_avanzadas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 30 | `20261105000001_separar_admin_global_y_manager_empresa.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 31 | `20261105000002_aislamiento_datos_por_empresa.sql` | ❓ Sin verificar | No crea objetos comprobables; sus políticas `company_scope_access` ya no existen (reemplazadas por migraciones posteriores). No se registró en la bitácora. |
| 32 | `20261105000003_soporte_autorizaciones_auditoria.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 33 | `20261105000004_restringir_acceso_papeles_contables.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 34 | `20261105000005_restringir_acceso_solicitudes_soporte.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 35 | `20261105000006_soporte_lectura_modulo_productos.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 36 | `20261105000007_soporte_lectura_inventario.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 37 | `20261105000008_soporte_lectura_ventas_compras_gastos.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 38 | `20261105000009_soporte_lectura_terceros_ordenes_compra.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 39 | `20261105000010_revocar_privilegios_anon_compras_credito.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 40 | `20261105000011_soporte_lectura_cartera_cuentas_por_pagar.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 41 | `20261105000012_soporte_lectura_caja_gastos_tesoreria.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 42 | `20261105000013_soporte_lectura_contabilidad.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 43 | `20261105000014_soporte_lectura_nomina.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 44 | `20261105000015_soporte_lectura_dispositivos_sesiones.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 45 | `20261105000016_aislamiento_seguridad_modulo_ia.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 46 | `20261105000017_soporte_lectura_sucursales.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 47 | `20261105000018_soporte_lectura_categorias.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 48 | `20261105000019_aislar_configuracion_empresa.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 49 | `20261105000020_aislar_invitaciones_empresa.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 50 | `20261105000021_aislar_ubicaciones_clientes.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 51 | `20261105000022_aislar_metas_vendedores.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 52 | `20261105000023_proteger_datos_personales_empleados.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 53 | `20261105000024_aislar_registros_visitas_gps.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 54 | `20261105000025_aislar_configuracion_cxc.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 55 | `20261105000026_aislar_configuracion_cxp.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 56 | `20261105000027_aislar_empresas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 57 | `20261105000028_aislar_auditoria_empresa.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 58 | `20261105000029_aislar_suscripciones_empresa.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 59 | `20261105000030_aislar_devoluciones_cotizaciones_y_rutas.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 60 | `20261105000031_aislar_perfiles_y_datos_personales.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 61 | `20261105000032_aislamiento_admin_plataforma_inventario.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 62 | `20261105000033_aislamiento_admin_soporte_inventario.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 63 | `20261105000034_soporte_admin_inventario_catalogo.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 64 | `20261105000035_habilitar_update_productos_authenticated.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 65 | `20261105000036_soporte_admin_company_config.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 66 | `20261105000037_aislamiento_admin_empresas_y_usuarios.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 67 | `20261105000038_aislamiento_funciones_admin_empresa_prueba.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 68 | `20261105000039_aislamiento_perfiles_y_autorizacion_soporte.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 69 | `20261105000040_restringir_ejecucion_anon_funciones_privilegiadas.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 70 | `20261105000041_ocultar_stock_exacto_verificacion_catalogo.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 71 | `20261105000042_restringir_acceso_directo_limites_planes.sql` | ✅ Aplicada | Consta en la bitácora original de Supabase; solo cambia políticas/permisos (sin tablas/funciones comprobables). |
| 72 | `20261105000043_revocar_acceso_anon_inventario_multibodega.sql` | ✅ Aplicada | Verificada por estado: `anon` no tiene privilegios sobre las tablas multibodega. |
| 73 | `20261105000044_seguridad_pin_seguimiento_pedidos_catalogo.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 74 | `20261105000045_admin_global_comercial_y_equipo_plataforma.sql` | ✅ Aplicada | Verificada: sus tablas/funciones existen en la base. |
| 75 | `20261107000040_bitacora_sql_trazabilidad_base.sql` | ✅ Aplicada | Bitácora SQL base: tabla `sql_migration_log`, `registrar_ejecucion_sql`, `admin_registrar_ejecucion_sql`. Se aplicó antes desde el SQL Editor y se **reconstruyó del esquema vivo** el 2026-11-07 (registrada como `backfill_reconstruido`). |
| 76 | `20261107000048_consolidar_contabilidad_acc_y_rendimiento.sql` | ✅ Aplicada | Consolida el modelo contable y agrega índices de rendimiento (ver sección 3). |
| 77 | `20261107000049_registro_unico_migraciones.sql` | ✅ Aplicada | Registro único + motor SQL corregido (ver sección 2). |
| 78 | `20261107000050_quitar_sobrecarga_admin_ejecutar_migracion_sql.sql` | ✅ Aplicada | Quita la sobrecarga antigua `(text,text,text)` del motor SQL, que no tenía el arreglo de transacciones. |
| 79 | `20261108000051_centro_direccion_gerencial_tablas_y_autorizaciones.sql` | ✅ Aplicada | Aplicada en la base viva (2026-11-09 13:54 UTC). Tablas multiempresa para Solicitudes de Autorización Gerencial (`manager_approval_requests`), Planes de Acción (`manager_action_plans`), Evaluaciones de Desempeño (`manager_employee_evaluations`) y Alertas Gerenciales (`manager_alert_statuses`) con RLS y permisos del rol gerente. |
| 80 | `20261109000052_reportes_dian_exogena_y_formularios.sql` | ✅ Aplicada | Aplicada en la base viva (2026-11-10 13:08:06 UTC, fuente: sql_editor_manual). Reportes DIAN: Medios Magnéticos Exógena (`dian_exogena_concepts`), Mapeo PUC (`dian_account_mappings`), Retenciones e ICA (`dian_tax_rules`), Certificados (`dian_certificates_issued`) y cálculo de Formularios Muisca 300 y 350. |
| 81 | `20261110000053_consolidacion_ciclo_comercial_caja_turnos_y_contabilidad.sql` | ✅ Aplicada | Aplicada en la base viva (2026-11-10 13:05:57 UTC, fuente: sql_editor_manual). Consolidación del ciclo comercial: turnos y sesiones de caja (`cash_shifts`), desglose y arqueo ciego por denominaciones (`cash_shift_denominations`), pagos múltiples en mostrador (`sale_payments`), cierres de caja (`cash_closings`, `cash_entries`) y contabilización automática NIIF en `acc_entries`/`acc_lines`. |
| 82 | `20261111000054_autorizacion_escritura_contable.sql` | ✅ Aplicada | Aplicada en la base viva (2026-11-11 10:38:00 UTC, fuente: sql_editor_manual). Autorización controlada de escritura contable para el rol 'contador': crea la función `can_write_accounting()` (dueno, admin_empresa, gerente, contador) y actualiza `acc_create_entry` y `acc_post_entry`. Mantiene `acc_reverse_entry` y `acc_close_period` restringidos exclusivamente a la gerencia (`is_manager()`). |

**Reemplazadas, NO ejecutar** (`supabase/migrations_superseded/`): `20261106000022_contable_pro_partida_doble_puc_niif.sql`, `20261106000046_sistema_contable_partida_doble.sql`, `20261106000047_reportes_financieros_contables.sql`.
Crean un libro contable paralelo (`accounts`, `journal_entries`, `journal_lines`, `fn_*`) que nunca se aplicó.

## 5. Plantilla para una migración nueva

```sql
-- supabase/migrations/AAAAMMDDNNNNNN_nombre_corto.sql   (sin BEGIN/COMMIT, idempotente)
-- 1) Qué hace y por qué (2-3 líneas)

create table if not exists public.mi_tabla ( ... );
-- RLS, políticas con DROP POLICY IF EXISTS + CREATE POLICY, índices en claves foráneas...

-- Pie de registro (obligatorio):
select public.sql_registrar_migracion(
  'AAAAMMDDNNNNNN_nombre_corto',
  'Título legible',
  'AAAAMMDDNNNNNN_nombre_corto.sql'
);
```
Después: agrega la fila a la sección 4 y, si es un paquete del Centro SQL, a `src/lib/sqlScripts.ts`.

## 6. Paquetes del Centro SQL (`src/lib/sqlScripts.ts`)

Cada paquete concatena archivos de `supabase/migrations/`. La app los marca **Activo** cuando todas sus `targetTables` existen (consulta `admin_estado_objetos`) o constan en la bitácora; si no, **Listo para aplicar**.
`sqlScripts.ts` quita `BEGIN;`/`COMMIT;` internos, envuelve en una sola transacción y agrega el pie de registro automáticamente. Para que un paquete nuevo salga bien: lista **todas** las tablas que crea en `targetTables`.

## 7. Pendientes conocidos (no críticos)

- Rendimiento: 21 políticas RLS usan `auth.*` sin `(select auth.*())` y hay ~86 avisos de políticas permisivas múltiples. Reescribir **una por una** (riesgo de abrir/cerrar accesos).
- Auth: activar «protección contra contraseñas filtradas» en el panel de Supabase (no se puede por SQL).
- Extensión `pg_net` está en el esquema `public` (moverla exige recrearla).
- Funciones `SECURITY DEFINER` ejecutables por `authenticated` (~177): su seguridad depende del chequeo interno de rol/empresa; revisar cuerpo por cuerpo (en especial `admin_*`).
- 1 de 5 empresas no tiene sucursal principal (se creó después de la inicialización); conviene crearla automáticamente al registrar empresa.
- `api/accounting.ts` guarda asientos en memoria de ejemplo y no se usa en producción; `server.ts` (Bun) es para ejecución propia, Vercel solo usa `vite build`.
