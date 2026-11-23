# Permisos por rol y página (Fuente única: `src/lib/pagePermissions.ts`)

> **Fuente única de verdad:** `src/lib/pagePermissions.ts` (política **deny-by-default** si falta el rol efectivo o la ruta no está declarada) y helpers en `src/lib/auth.tsx`.
> El menú (`src/components/AppLayout.tsx`), el guardián de rutas (`src/App.tsx`), el simulador «Paso Maestro» (`masterRoleOverride`) y las vistas internas usan esta misma definición, sincronizada con las migraciones SQL `20261115000065_corregir_permisos_y_seguridad_fase_b.sql`, `20261116000066_blindaje_etapa1_auditoria_77cd7d5.sql` y `20261117000067_blindaje_recepcion_ordenes_compra.sql`.
> Ningún cambio de rol en frontend sustituye las validaciones SQL (`_require_company_roles`, `can_view_accounting()`, `can_write_accounting()`, políticas RLS y privilegios de tabla/función).

---

## 1. Criterio de separación de funciones por rol (Etapa 1 — Fase B)

- **Administrador Central (`admin` / `super_admin`):** administración global de plataforma y usuarios (`companies`, `adminplans`, `users`, `sqlcenter`) y control operativo sobre su empresa activa (`current_company_id()`). Sin excepción de acceso cruzado sobre registros DIAN de otras empresas.
- **Dueño (`dueno`) y Admin de Empresa (`admin_empresa`):** paridad total en operaciones empresariales dentro de su propia empresa (compras, devoluciones a proveedor, anulación de compras/devoluciones, CxP, pagos a proveedores, cierre/reapertura contable, PUC y parámetros). `subscription` permanece restringido a `dueno` / `admin`.
- **Gerente (`gerente` — Decisión 3B):** dirección estratégica, supervisión operativa ERP, conciliación (`acc_reconcile`), configuración contable (`acc_save_settings`, `acc_post_pending`, `acc_close_period`, `acc_seed_template`), clasificación de IVA (`clasificar_iva_compra`) y consulta de compras, órdenes de compra, CxP, devoluciones a proveedor y DIAN. **No** registra compras directas, **no** anula compras ni devoluciones a proveedor, **no** registra/anula pagos ni cupos de CxP y **no** muta proveedores ni órdenes de compra.
- **Contador Público (`contador` — Decisión 1A):** alcance estricto contable/tributario (PUC consulta, asientos manuales/ajuste propios `acc_create_entry` y `acc_post_entry` únicamente sobre borradores propios con `source_type IN ('manual', 'ajuste')`, estados financieros, despacho contable, conciliación `acc_reconcile`, Conciliación Bancaria Manual `bankrecon` para captura de extractos/movimientos, cruces manuales y confirmación; clasificación de IVA en compras `clasificar_iva_compra`, consulta de devoluciones a proveedor y módulo tributario/DIAN F300/F350). **No** administra cuentas bancarias (`bank_upsert_account`, `bank_toggle_account_status`), **no** anula movimientos/cruces/extractos bancarios (`bank_void_*`), **no** reabre extractos confirmados (`bank_reopen_statement`), **no** contabiliza borradores operativos ni de terceros, **no** modifica parámetros estructurales (`acc_save_settings`, `acc_activate`), **no** administra/siembra el PUC (`acc_seed_template`, `acc_upsert_account`), **no** contabiliza en lote (`acc_post_pending`), **no** reversa asientos ni cierra/reabre periodos, y **no** crea compras/pagos/devoluciones.
- **Compras (`comprador` — Decisión 2A):** compras directas (`_registrar_compra_impl` / `registrar_compra_con_iva`), proveedores (`suppliers` CRUD) y ciclo completo de órdenes de compra (`crear_orden_compra`, `cambiar_estado_orden_compra`, `recibir_orden_compra`). **No** anula compras, **no** registra ni anula devoluciones financieras a proveedor y **no** accede a CxP ni pagos.
- **Almacén (`almacen` — Decisión 2A):** inventario físico, bodegas, traslados, lotes, kardex, toma física, logística y **exclusivamente recepción física de órdenes de compra aprobadas/enviadas/parciales** (`recibir_orden_compra`), requiriendo una bodega destino específica y activa compatible con la sucursal de la orden (sin recibir en inventario general sin bodega) y sin poder modificar forma de pago, días de crédito, costos unitarios ni la bodega destino ya asignada en la OC (`target_warehouse_id`). **No** registra compras directas, **no** anula compras, **no** gestiona proveedores, **no** toca CxP ni devoluciones financieras a proveedor.
- **Vendedor (`vendedor` — Decisión 4A):** conserva exactamente sus 10 vistas comerciales (`pos`, `sales`, `quotations`, `catalog`, `customers`, `myroute`, `map`, `goals`, `employee_portal`, `products`) **sin** acceso a `cash` (Cierre de caja).
- **Cajero POS (`cajero`):** mostrador POS, ventas, caja y arqueos (`cash`), cartera, devoluciones de clientes (solo pestaña clientes), cambios/garantías y consulta de productos.
- **Transporte (`transportador`):** alcance estricto logístico (`warehouses`, `map`, `dispatch`, `routeplan`, `dispatch_history`, `equipment_assets`).
- **Soporte (`tecnico`):** `copilot`, `ask`, `products`, `support`, `manual`.

---

## 2. Matriz funcional y de RPC (Compras, IVA, Devoluciones, CxP, Contabilidad, Conciliación Bancaria y DIAN)

| Rol | Ver módulo | Ver datos empresa propia | Crear / Operar | Editar / Clasificar IVA | Anular / Reversar / CxP / Reabrir | Conciliar (`acc_reconcile` / `bankrecon`) |
|---|---|---|---|---|---|---|
| `admin` / `super_admin` | Contabilidad, DIAN, Compras, OC, Devoluciones, Proveedores, CxP, Conciliación bancaria | Sí (solo su `current_company_id()`) | Sí (compras, OC, asientos, PUC, DIAN, pagos, cuentas/extractos bancarios) | Sí (clasifica IVA, settings contables, créditos proveedor, cuentas bancarias) | Sí (anula compras/devoluciones/pagos/conciliación, abre/cierra periodos y reabre extractos) | Sí |
| `dueno` | Todos los módulos empresariales (sin SaaS global) | Sí | Sí | Sí | Sí (paridad empresarial completa, incluida reapertura bancaria) | Sí |
| `admin_empresa` | Todos los módulos empresariales (sin SaaS global/`users`) | Sí | Sí | Sí | Sí (paridad total con `dueno` en empresa, incluida reapertura bancaria) | Sí |
| `gerente` | Dirección, Supervisión, Compras, OC, Devoluciones, Proveedores, CxP, Contabilidad, DIAN, Conciliación bancaria | Sí (consulta integral) | Asientos manuales, cierre contable y cuentas/extractos bancarios; **no** compras directas ni OC ni pagos CxP | Clasifica IVA (`clasificar_iva_compra`), settings contables, `acc_post_pending`, administración de cuentas bancarias; **no** muta proveedores ni cupo CxP | **No** anula compras, **no** registra/anula devoluciones a proveedor, **no** paga ni anula CxP, **no** reabre extractos confirmados (`bank_reopen_statement`); sí anula renglones/cruces/extractos abiertos | Sí |
| `contador` | Contabilidad (12 rutas incl. `bankrecon`), DIAN, Impuestos, Compras (IVA), Devoluciones (consulta proveedor) | Sí (contable, DIAN, compras, devoluciones proveedor, proveedores lectura, conciliación bancaria) | Solo asientos manuales/ajuste (`acc_create_entry`, `acc_post_entry`), extractos/movimientos bancarios y certificados/DIAN | Clasifica IVA (`clasificar_iva_compra`); **no** `acc_save_settings`, **no** PUC/plantilla, **no** `acc_post_pending`, **no** administra cuentas bancarias | **No** anula compras/devoluciones/asientos/ítems bancarios, **no** cierra/reabre periodos ni extractos confirmados, **no** CxP | Sí (cruces manuales, diferencias y confirmación) |
| `comprador` | Panel, Compras, OC, Sugerencias compra, Proveedores, Kardex | Compras, OC, Proveedores (sin CxP ni devoluciones) | Sí en compras directas, proveedores y OC (`crear`, `cambiar_estado`, `recibir`) | Sí en proveedores y OC | **No** anula compras, **no** devoluciones a proveedor, **no** CxP | No |
| `almacen` | Inventario, Bodegas, Lotes, Kardex, OC (recepción), Sugerencias | OC aprobadas/enviadas/parciales e inventario | Solo recepción física de OC (`recibir_orden_compra` con pago/plazo/costo bloqueados) | **No** edita precios, pago ni días de crédito | **No** compras directas, **no** anula compras, **no** devoluciones, **no** proveedores, **no** CxP | No |
| `vendedor` | 10 vistas comerciales (`pos`..`products`, sin `cash`) | Ventas propias y catálogo/clientes | Ventas POS, cotizaciones, clientes | Según módulo comercial | No | No |
| `cajero` | POS, Caja (`cash`), Ventas, Cartera, Devoluciones clientes | POS, caja y devoluciones clientes | Ventas, abonos, devoluciones de clientes | Caja y cobros | No en compras/contabilidad | No |

---

## 2.1. Inspección bancaria temporal por Soporte Técnico

El acceso de Soporte Técnico a la conciliación bancaria no es un permiso empresarial permanente ni concede acceso general al módulo.

- La inspección requiere un ticket de soporte activo, asociado a la empresa (`company_id`), al módulo `bankrecon` y a una autorización vigente.
- La autorización se comprueba mediante los controles de soporte, incluida la validación de `support_has_active_authorization` y el registro de acceso mediante `support_register_access`.
- El alcance de la autorización debe corresponder al ticket y a la empresa inspeccionada. Se conserva el aislamiento entre empresas.
- La inspección es exclusivamente de lectura. Incluso si el ticket contempla `intervencion_asistida`, esta excepción no habilita al técnico para crear, editar, conciliar, confirmar, anular ni reabrir registros bancarios.
- Al revocarse o expirar la autorización, la vista de inspección debe dejar de mostrar los datos bancarios protegidos.
- Esta autorización temporal no sustituye los permisos empresariales de `dueno`, `admin_empresa`, `gerente` o `contador`, ni permite al administrador de plataforma consultar otras empresas por el solo hecho de ser administrador de plataforma.

## 3. Matriz completa de acceso por página (`src/lib/pagePermissions.ts`)

| Sección | Página | `id` | Admin | Dueño | Adm. emp. | Gerente | Contador | Vendedor | Cajero | Almacén | Compras | Transp. | Soporte |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Gerencia | Centro de Dirección Gerencial | `manager_center` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 1. Resumen Ejecutivo | `manager_summary` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 2. Dirección Comercial | `manager_commercial` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 3. Dirección de Operaciones | `manager_operations` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 4. Dirección Financiera | `manager_financial` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 5. Dirección del Talento Humano | `manager_hr` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 6. Centro de Autorizaciones | `manager_authorizations` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 7. Planes de Acción Gerencial | `manager_action_plans` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 8. Inteligencia Empresarial | `manager_intelligence` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 9. Informes Gerenciales | `manager_reports` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Gerencia | 10. Notificaciones Gerenciales | `manager_notifications` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Principal | Panel ejecutivo | `dashboard` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · |
| Principal | Centro de mando | `command` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Principal | Resumen del día | `summary` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Principal | Copiloto | `copilot` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Principal | Pregúntale al Copiloto | `ask` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Principal | Acciones de IA (Aprobaciones) | `ai_actions` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Ventas y cobros | Mostrador (POS) | `pos` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Pedidos omnicanal | `omnichannel` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Catálogo comercial | `catalog` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Pedidos de catálogo | `catorders` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Ventas | `sales` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Trazabilidad y despachos | `dispatch_history` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | ✓ | · |
| Ventas y cobros | Plan Separe y apartados | `layaways` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Cartera (fiado) | `cartera` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Cotizaciones | `quotations` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Clientes | `customers` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Devoluciones | `devolutions` | ✓ | ✓ | ✓ | ✓ | ✓ (solo prov. lectura) | · | ✓ (solo clientes) | · | · | · | · |
| Ventas y cobros | Cambios y garantías | `exchanges` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Equipo y nómina | `sellers` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Ventas y cobros | Portal de vendedor | `employee_portal` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Planificar rutas | `routeplan` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · |
| Ventas y cobros | Despacho de ruta | `dispatch` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · |
| Ventas y cobros | Metas | `goals` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | · | · | · | · |
| Compras y pagos | Órdenes de compra | `purchaseorders` | ✓ | ✓ | ✓ | ✓ (consulta) | · | · | · | ✓ (solo recepción) | ✓ | · | · |
| Compras y pagos | Compras | `purchases` | ✓ | ✓ | ✓ | ✓ (consulta/IVA) | ✓ (consulta/IVA) | · | · | · | ✓ (creación) | · | · |
| Compras y pagos | Cuentas por pagar | `payables` | ✓ | ✓ | ✓ | ✓ (consulta) | · | · | · | · | · | · | · |
| Compras y pagos | Sugerencia de compras | `buyplan` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | · |
| Compras y pagos | Proveedores | `suppliers` | ✓ | ✓ | ✓ | ✓ (consulta) | · | · | · | · | ✓ | · | · |
| Compras y pagos | Evaluación proveedores | `supplier_intel` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · |
| Inventario | Productos | `products` | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | · | ✓ |
| Inventario | Escudo de precios | `priceshield` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Inventario | Toma física ciega | `blindcount` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Inventario | Sedes y multibodega | `warehouses` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · |
| Inventario | Balanceo de sedes | `branch_balance` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Inventario | Activos y maquinaria | `equipment_assets` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | ✓ | · |
| Inventario | Categorías | `categories` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Inventario | Lotes y vencimientos | `lots` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Inventario | Kardex | `kardex` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | · |
| Inventario | Etiquetas | `labels` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · |
| Caja y gastos | Tesorería y presupuesto | `treasury` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Caja y gastos | Conciliación bancaria | `bankrecon` | ✓ | ✓ | ✓ | ✓ (sin reapertura) | ✓ (sin adm. cuentas/anulación/reapertura) | · | · | · | · | · | · |
| Caja y gastos | Caja y arqueos | `cash` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Caja y gastos | Gastos operativos | `expenses` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Caja y gastos | Detección de anomalías | `anomaly_detector` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Caja y gastos | Vencimientos legales | `compliance` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Reportes | `reports` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Rentabilidad | `profit` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Predicciones | `predict` | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | · |
| Análisis | Estadísticas | `stats` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Mapa y rutas | `map` | ✓ | ✓ | ✓ | ✓ | · | ✓ | · | ✓ | · | ✓ | · |
| Análisis | Historial de auditoría | `history` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Contabilidad | Despacho contable | `cpa` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Catálogo PUC NIIF | `accounting` / `accounting_puc` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Registrar Asiento Diario | `journal_entry` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Centro de Estados Financieros | `accstate` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Centros de costo | `costcenters` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Contabilidad | Config. contable / Conciliación | `accsetup` | ✓ | ✓ | ✓ | ✓ | ✓ (conciliación) | · | · | · | · | · | · |
| Contabilidad | Cierre de libros | `accclose` | ✓ | ✓ | ✓ | ✓ | ✓ (consulta) | · | · | · | · | · | · |
| Contabilidad | Impuestos | `taxes` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Centro Tributario DIAN | `dian_compliance` | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · |
| Contabilidad | Migración Siigo / Loggro | `erpbridge` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Administración | API y Webhooks | `api_ecosystem` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Administración | Equipo y dispositivos | `team` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Administración | Usuarios de plataforma | `users` | ✓ | · | · | · | · | · | · | · | · | · | · |
| Administración | Empresas clientes | `companies` | ✓ | · | · | · | · | · | · | · | · | · | · |
| Administración | Activar planes | `adminplans` | ✓ | · | · | · | · | · | · | · | · | · | · |
| Administración | Suscripción | `subscription` | ✓ | ✓ | · | · | · | · | · | · | · | · | · |
| Administración | SQL Center | `sqlcenter` | ✓ | · | · | · | · | · | · | · | · | · | · |
| Administración | Configuración | `settings` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Soporte | Soporte y Manual | `support` / `manual` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Mi jornada | Mi ruta de hoy | `myroute` | · | · | · | · | · | ✓ | · | · | · | · | · |

---

## 4. Verificación en base viva de funciones base (solo lectura `pg_get_functiondef`)

Se consultaron en modo solo lectura las 6 funciones base no versionadas previamente en `supabase/migrations/`:
- `public.acc_activate`, `public.acc_upsert_account`, `public.acc_close_period`, `public.acc_reverse_entry`: verificadas con `public.is_manager()` → `public.is_company_manager()`, que exige `p.active = true`, `p.company_id IS NOT NULL` y `p.role IN ('dueno', 'admin_empresa', 'gerente')` (bloqueando al rol `contador` y a perfiles inactivos conforme a las Decisiones 1A y 3B).
- `public._ctx(text[])`: exige `p.active = true` y `p.company_id IS NOT NULL` antes de validar `p_roles`.
- `public.acc_reopen_period(integer, integer, text)`: en la base viva restringía solo a `dueno` sin verificar `active = true` ni incluir `admin_empresa`; quedó corregida dentro de la migración `000065` usando `public._require_company_roles(array['admin', 'dueno', 'admin_empresa'])`.
