# InventarioPro: auditoría de fortalecimiento (entrega)

**Estado:** scripts preparados y revisados a mano. **No se ejecutaron**: no hay acceso a Postgres/Supabase en este entorno.
Pruébalos en un proyecto de PRUEBAS (copia de la base de producción) antes de tocar producción.
**Cambios en el frontend: ninguno (AppLayout.tsx queda como estaba)** (no cambia ningún nombre, parámetro ni respuesta de RPC).

## Orden de ejecución
| # | Archivo | Qué hace | Si falla |
|---|---------|----------|----------|
| 0 | `00_diagnostico_solo_lectura.sql` | Solo lectura. Compara con lo "esperado" de cada bloque. | — |
| 1 | `01_respaldo_estado_actual.sql` | Respalda cuerpos, search_path y EXECUTE de todas las funciones. | No sigas |
| 2 | `02_usuarios_desactivados_y_perfiles.sql` | Desactivados sin acceso; protege plan_courtesy/plan_note/plan_granted_at | paso 1 de 99 |
| 3 | `03_search_path_seguro.sql` | `pg_catalog, public, pg_temp` en funciones con `public` | paso 2 de 99 |
| 4 | `04_privilegios_execute.sql` | EXECUTE mínimo; internas solo service_role; anon sin funciones | paso 3 de 99 |
| 5 | `05_aislamiento_multitenant.sql` | Guarda en customer_locations; valida vendedor en guardar_meta | pasos 1 y 5 |
| 6 | `06_integridad_contable.sql` | Índice único por documento/evento; lock en acc_system_entry; no revertir reversos | pasos 1 y 6 |
| 7 | `07_suscripcion_en_servidor_OPCIONAL.sql` | Bloqueo por suscripción vencida en tablas acc_*, rutas, metas, personal | paso 7 |
| 8 | `08_pruebas_en_proyecto_de_pruebas.sql` | Pruebas automáticas (reemplaza los 5 UUID) | — |
| 9 | `09_historial_vendedor_ve_su_trabajo.sql` | Historial: dueño/admin todo; vendedor solo sus ventas/devoluciones/abonos/cotizaciones | paso 8 de 99 |
| 99 | `99_reversion.sql` | Restaura todo desde el respaldo (por pasos) | — |

Entre 4 y 8 prueba a mano en la app: login y recuperación de contraseña, venta (efectivo, fiado, mixto), anular venta,
compra y anular compra, devolución, abono y anular abono, caja y arqueo, lotes, rutas/mi ruta, metas, notificaciones push,
cierre y reapertura de periodo, invitar vendedor, activar plan desde Usuarios y Activar planes, Historial.

## Decisiones que te corresponden
* **Historial (audit_log)**: dueño/admin ven todo; el vendedor ve solo su propio trabajo de venta (script 09, sin cambios de frontend).
* **Script 07** cambia comportamiento (con suscripción vencida deja de poder operar la parte contable): ejecútalo solo si lo quieres.
* Reversar a mano (acc_reverse_entry) un asiento de sistema deja el documento "completado" sin asiento; `acc_reconcile` lo marca
  como diferencia. Decide si debe prohibirse para asientos de venta/compra/abono/devolución.

## Pendientes que necesito para cerrar la auditoría
Resultado de 0.1 a 0.12 (sobre todo 0.1 y las definiciones de 0.12: `anular_venta`, `anular_compra`, `crear_invitacion`,
`lotes_*`, `mi_ruta_hoy`, `push_*`, `route_stops_autoclose`, `_cp_lines`, `_lot_*`, `_pred_*_core`, `copilot_*`).
Sin ellas no puedo confirmar: anulación de una venta que tiene devoluciones, aislamiento de `lotes_*`, `_pred_*_core`
y `_cp_lines` (reciben la empresa como parámetro), ni la política de invitaciones.

---
# Informe de hallazgos (Fase D)

## Vulnerabilidades / defectos confirmados
| # | Hallazgo | Corrige | Estado en producción |
|---|----------|---------|----------------------|
| 1 | `is_manager`, `my_company`, `current_company_id`, `_my_role`, `assert_admin` ignoraban `active`: un dueño/admin desactivado seguía viendo y operando (reproducido con datos reales: `list_team` devolvía 2 personas) | 02 | **Aplicado** (verificado) |
| 2 | Funciones internas SECURITY DEFINER con empresa/id como parámetro y `push_drop`/`push_mark_sent` sin comprobación de identidad, ejecutables por la API | 04 | **Aplicado** (pruebas 141, 142, 146) |
| 3 | `customer_locations`: se podía apuntar una ubicación a un cliente de otra empresa y bloquear la legítima | 05 | Pendiente |
| 4 | `guardar_meta` no validaba que el vendedor fuera de la empresa | 05 | Pendiente |
| 5 | Sin garantía en BD contra doble asiento por documento/evento ni doble reverso; `acc_system_entry` sin bloqueo | 06 | Pendiente |

## Riesgos potenciales / mejoras preventivas
* `search_path = public` en 61 funciones (explotación práctica baja por la API): script 03, pendiente.
* Historial visible a todos los roles con costos y proveedores: script 09 (el vendedor conserva su record de ventas), pendiente.
* Reversar un reverso reactiva el asiento original en estado inconsistente: script 06, pendiente.
* Tablas sin trigger de suscripción vencida (acc_*, rutas, metas, personal): script 07, **opcional**.
* `mi_ruta_hoy` sin filtro de empresa en el cliente (ya protegido al escribir por `guardar_plan_rutas`): endurecido en 05.
* `protect_profile_columns` sin `plan_courtesy/plan_note/plan_granted_at` (hoy ya impedido por permisos de columna): refuerzo en 02, aplicado.

## Comportamiento correcto que se conserva
`anular_venta` (rechaza ventas con devoluciones o abonos activos; revierte caja, kardex, lotes y asiento), `anular_compra`
(rechaza si hay lotes vendidos o stock insuficiente), `registrar_*` con bloqueo de filas e idempotencia por `client_uuid`,
guardas de asientos contabilizados, partida doble, cierre y reapertura de periodos, `guardar_plan_rutas` (valida vendedor y
clientes de la empresa), funciones `copilot_*`, `rentabilidad_productos`, `pred_*` (solo gestores o filtradas por vendedor),
`_cp_lines`, `_lot_*` y `_pred_*_core` (no ejecutables por la API). Revisadas: todas las funciones del proyecto exportadas.

## Riesgos que quedan abiertos (decisión tuya)
1. `anular_compra` no restaura el costo anterior del producto (`products.cost` queda con el costo de la compra anulada).
2. Códigos de invitación de 8 caracteres hexadecimales (riesgo bajo; cambiarlos exige tocar la pantalla de registro).
3. Zonas horarias por defecto mezcladas (`America/Bogota` en ventas/resúmenes, `America/Caracas` en contabilidad) para empresas
   sin zona configurada.
4. `push_subscribe` reasigna una suscripción si se conoce su endpoint (endpoint secreto; riesgo bajo).

## Pruebas
Resultados de 08 en producción (sin modificar datos): permisos y `anon` correctos; las filas "instalado" y las pruebas de
aislamiento dependen de aplicar 03, 05, 06 y 09. Las pruebas de usuario desactivado solo en un proyecto de pruebas
(`v_permitir_desactivar := true`) o con un usuario realmente desactivado.

## Cierre
La auditoría se considera cerrada cuando 03, 05, 06 y 09 estén aplicados, 08 pase completo y la app pase la revisión manual
(venta, anulaciones, abono, devolución, caja, lotes, rutas, push, cierre/reapertura de periodo, invitaciones, planes).

---
# Centro de Control Empresarial y Financiero (Fases 1 y 2)

Orden recomendado para habilitar todas las capacidades corporativas en Supabase (`SQL Editor`):

1. `20261101000003_roles_y_admins.sql` y `20261101000004_permisos_contabilidad.sql` — Roles corporativos (`dueno`, `admin_empresa`, `gerente`, `contador`, `comprador`, `almacen`, `cajero`, `vendedor`, `transportador`).
2. `20261101000005_sucursales_y_bodegas.sql` hasta `20261102000012_ventas_por_bodega.sql` — Sucursales, multibodega, existencias por almacén, traslados auditados, reservas y ventas por bodega (`registrar_venta_bodega`).
3. `20261103000013_tesoreria_centros_costo_ordenes_compra.sql` — **Fase 2**:
   - **Centros de costo por sucursal (`branch_id`)** en `sales`, `purchases`, `expenses` y `acc_entries`, más RPC `asignar_centro_costo_operacion`.
   - **Presupuesto maestro mensual (`financial_budgets`)** con RLS por empresa y RPCs `upsert_financial_budget` / `delete_financial_budget`.
   - **Órdenes de compra (`purchase_orders` y `purchase_order_items`)** con flujo `draft → approved → sent → partial / received` y recepción auditada transaccional (`recibir_orden_compra`) que alimenta `registrar_compra`, Kardex, `warehouse_stock`, lotes y cuentas por pagar.
4. `20261103000014_presupuesto_maestro_storage_imagenes_catalogo_vendedor.sql` — **Fase 3**:
   - **Presupuesto Maestro reforzado (`financial_budgets`)**: políticas RLS completas por empresa, clonación intermensual con ajuste porcentual (`clonar_presupuesto_mes`) y consolidado ejecutivo en servidor (`resumen_presupuesto_ejecucion`).
   - **Fotografías reales de productos (`storage.buckets` → `product-images` + `products.image_url`)**: bucket público de hasta 5 MB por foto (JPG/PNG/WebP) con aislamiento de escritura por `company_id` y RPC `actualizar_imagen_producto`.
   - **Catálogo Comercial y Vitrina Digital**: columnas `description`, `featured` y `catalog_visible` en `products`, más actualización de `obtener_catalogo_publico`.
5. `20261103000015_tabla_imagenes_productos_y_sincronizacion_pos.sql` — **Tabla dedicada de Imágenes y Sincronización POS / PDF**:
   - **Tabla `public.product_images`** (`id`, `company_id`, `product_id` único, `image_url`, `storage_path`, `mime_type`, `updated_by`, `updated_at`) con políticas RLS multiempresa para roles operativos (`admin`, `dueno`, `admin_empresa`, `gerente`, `almacen`, `comprador`, `cajero`, `vendedor`).
   - **Sincronización automática**: trigger `trg_sync_product_images_to_products` hacia `public.products.image_url`, migración inicial de fotos existentes, compatibilidad `current_company_id()` / `my_company()` y RPC `actualizar_imagen_producto` con retorno JSON verificado (`{ ok: true }`).
