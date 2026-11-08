# Permisos por rol y página (generado desde `src/lib/pagePermissions.ts`)

> Fuente única de verdad: `src/lib/pagePermissions.ts`. El menú (`AppLayout.tsx`), el guardián (`App.tsx`), los atajos del Panel y el simulador «Paso Maestro» usan **esta misma tabla**.
> Para cambiar lo que ve un rol edita ese archivo y vuelve a generar este documento. La página y la RPC de la base deben exigir lo mismo o menos que lo que aquí se permite.
> Roles de alcance estricto (`contador`, `vendedor`, `gerente`, `transportador`): solo ven las páginas de `STRICT_ROLE_PAGES`; sus menús están definidos aparte en `AppLayout.tsx`.
> Pantalla de inicio por rol: `getDefaultPageForRole` en `src/lib/auth.tsx` (cajero y vendedor → Mostrador POS; no ven el Panel ejecutivo).

## Área de cada rol (criterio aplicado)
- **Almacén («Jefe de almacén y bodegas»):** inventario, bodegas, traslados, lotes, etiquetas, kardex, toma física, logística (despachos, rutas, mapa, activos) y recepción de órdenes de compra. **Sin** ventas, clientes, catálogo comercial, cartera, compras/pagos a proveedores ni aprobaciones de IA.
- **Compras:** órdenes de compra, compras, sugerencia de compras, proveedores y su evaluación; consulta de productos y kardex. Sin ventas ni logística.
- **Vendedor (tienda o ruta):** mostrador/POS, sus ventas (historial propio; la base solo le deja ver las suyas), Mi ruta de hoy y el mapa de la ruta que le asignaron, cotizaciones, clientes, catálogo, metas, su portal e inventario en consulta. **No maneja caja** (sin Cierre de Caja). La base solo permite anular ventas a admin y dueño.
- **Cajero POS:** mostrador, ventas, caja y arqueos, clientes, devoluciones/cambios y consulta de productos. Sin panel ejecutivo ni kardex.
- **Dueño / Admin empresa / Admin:** todo lo de su empresa (Admin además la plataforma).
- **Acciones de IA (Aprobaciones):** solo gerencia (admin, dueño, admin empresa). Cada propuesta indica su «rol requerido»; admin y dueño ven todas, admin empresa todas menos las de dueño. **Hoy son propuestas de demostración** (guardadas en el navegador, vienen de `src/lib/innovationsRepo.ts`) y aprobar NO ejecuta nada real.

| Sección | Página | id | Admin | Dueño | Adm. empresa | Gerente | Contador | Vendedor | Cajero POS | Almacén | Compras | Transporte | Soporte |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Principal | Panel ejecutivo | `dashboard` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · | ✓ |
| Principal | Centro de mando | `command` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Principal | Resumen del día | `summary` | ✓ | ✓ | · | · | · | · | · | · | · | · | · |
| Principal | Copiloto | `copilot` | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Principal | Pregúntale al Copiloto | `ask` | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Principal | Acciones de IA (Aprobaciones) | `ai_actions` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Ventas y cobros | Mostrador (POS) | `pos` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Pedidos omnicanal | `omnichannel` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Catálogo comercial | `catalog` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Pedidos de catálogo | `catorders` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Ventas | `sales` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Trazabilidad y despachos | `dispatch_history` | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | · |
| Ventas y cobros | Plan Separe y apartados | `layaways` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Cartera (fiado) | `cartera` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Cotizaciones | `quotations` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Clientes | `customers` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Devoluciones | `devolutions` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Cambios y garantías | `exchanges` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Ventas y cobros | Equipo y nómina | `sellers` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Ventas y cobros | Portal de vendedor | `employee_portal` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Ventas y cobros | Planificar rutas | `routeplan` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | ✓ | · |
| Ventas y cobros | Despacho de ruta | `dispatch` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | ✓ | · |
| Ventas y cobros | Metas | `goals` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | · | · | · | · |
| Compras y pagos | Órdenes de compra | `purchaseorders` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · | · |
| Compras y pagos | Compras | `purchases` | ✓ | ✓ | ✓ | · | · | · | · | · | ✓ | · | · |
| Compras y pagos | Cuentas por pagar | `payables` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Compras y pagos | Sugerencia de compras | `buyplan` | ✓ | ✓ | ✓ | · | · | · | · | · | ✓ | · | · |
| Compras y pagos | Proveedores | `suppliers` | ✓ | ✓ | ✓ | · | · | · | · | · | ✓ | · | · |
| Compras y pagos | Evaluación proveedores | `supplier_intel` | ✓ | ✓ | ✓ | · | · | · | · | · | ✓ | · | · |
| Inventario | Productos | `products` | ✓ | ✓ | ✓ | · | · | ✓ | ✓ | ✓ | ✓ | · | ✓ |
| Inventario | Escudo de precios | `priceshield` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Inventario | Toma física ciega | `blindcount` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · | · |
| Inventario | Sedes y multibodega | `warehouses` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | ✓ | · |
| Inventario | Balanceo de sedes | `branch_balance` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · | · |
| Inventario | Activos y maquinaria | `equipment_assets` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | ✓ | · |
| Inventario | Categorías | `categories` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · | · |
| Inventario | Lotes y vencimientos | `lots` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · | · |
| Inventario | Kardex | `kardex` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · | · |
| Inventario | Etiquetas | `labels` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | · | · | · |
| Caja y gastos | Tesorería y presupuesto | `treasury` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Caja y gastos | Conciliación bancaria | `bankrecon` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Caja y gastos | Caja y arqueos | `cash` | ✓ | ✓ | ✓ | · | · | · | ✓ | · | · | · | · |
| Caja y gastos | Gastos operativos | `expenses` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Caja y gastos | Detección de anomalías | `anomaly_detector` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Caja y gastos | Vencimientos legales | `compliance` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Reportes | `reports` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Rentabilidad | `profit` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Predicciones | `predict` | ✓ | ✓ | ✓ | · | · | · | · | ✓ | ✓ | · | · |
| Análisis | Estadísticas | `stats` | ✓ | ✓ | ✓ | ✓ | · | · | · | · | · | · | · |
| Análisis | Mapa y rutas | `map` | ✓ | ✓ | ✓ | · | · | ✓ | · | ✓ | · | ✓ | · |
| Análisis | Historial de auditoría | `history` | ✓ | ✓ | ✓ | ✓ | · | · | ✓ | · | · | · | · |
| Contabilidad | Despacho contable | `cpa` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Contabilidad | Catálogo PUC NIIF | `accounting` | ✓ | ✓ | ✓ | · | ✓ | · | · | · | · | · | · |
| Contabilidad | Registrar Asiento Diario | `journal_entry` | ✓ | ✓ | ✓ | · | ✓ | · | · | · | · | · | · |
| Contabilidad | Centro de Estados Financieros (Balances) | `accstate` | ✓ | ✓ | ✓ | · | ✓ | · | · | · | · | · | · |
| Contabilidad | Centros de costo | `costcenters` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Contabilidad | Config. contable | `accsetup` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Contabilidad | Cierre de libros | `accclose` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Contabilidad | Impuestos | `taxes` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Contabilidad | Migración Siigo / Loggro | `erpbridge` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| — | support | `support` | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Administración | API y Webhooks | `api_ecosystem` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Administración | Equipo y dispositivos | `team` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Administración | Usuarios de plataforma | `users` | ✓ | · | · | · | · | · | · | · | · | · | · |
| Administración | Configuración | `settings` | ✓ | ✓ | ✓ | · | · | · | · | · | · | · | · |
| Administración | Manual de usuario | `manual` | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | ✓ | · | ✓ |
| Mi jornada | Mi ruta de hoy | `myroute` | · | · | · | · | · | ✓ | · | · | · | · | · |

✓ = ve la página en el menú y puede abrirla · · = no.

## Reglas de la base de datos que limitan lo anterior (verificadas 2026-11-07)
- `cuentas_por_pagar()` (RPC): solo `admin` y `dueno`.
- `resumen_diario` / «Resumen del día»: solo `admin` y `dueno`.
- `can_manage_inventory()`: admin, dueno, admin_empresa, gerente, almacen.

## Datos de demostración (no reales) en la app
`src/lib/innovationsRepo.ts` guarda en `localStorage` datos de ejemplo para: pedidos omnicanal, propuestas de IA, sugerencias de balanceo de sedes, evaluación de proveedores, anomalías, comprobantes de entrega, activos y maquinaria, cumplimiento y llaves de API. Los contadores de la tarjeta «Plataforma Inteligente de Operaciones» del Panel salen de ahí.
