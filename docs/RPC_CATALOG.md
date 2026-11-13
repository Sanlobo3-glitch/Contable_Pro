# Catálogo de Procedimientos Almacenados (RPC) Críticos

**Sistema:** Contable Pro (ERP Financiero, Comercial y Contable)  
**Fecha de corte:** 2026-11-13  
**Arquitectura:** PostgreSQL + Supabase (Multi-tenant con `company_id` y RLS al 100%)

---

## 1. Ciclo Comercial y Facturación

### 1.1 `registrar_venta(p_customer_id, p_items, p_payment_method, p_geo, p_client_id, p_captured_at, p_channel, p_discount, p_received, p_fx_currency, p_fx_amount, p_fx_rate, p_base_amount)`
- **Propósito:** Registra una venta individual en mostrador o ruta, descuenta inventario, vincula el turno de caja abierto (`shift_id`), inserta ingreso de caja si es efectivo y dispara el asiento contable NIIF (`acc_entries` / `acc_lines`).
- **Tablas afectadas:** `sales`, `products`, `kardex`, `cash_entries`, `acc_entries`, `acc_lines`.
- **Nivel de seguridad:** `SECURITY DEFINER`, `search_path` fijado, valida `company_id` vía `_ctx(null)`.

### 1.2 `registrar_venta_multipago(p_customer_id, p_items, p_payments, p_warehouse_id, p_shift_id, p_geo, p_client_id, p_captured_at, p_channel, p_discount, p_received)`
- **Propósito:** Registra de forma atómica (ACID) una venta con múltiples medios de pago (`efectivo`, `tarjeta`, `transferencia`, `fiado`), valida bodega activa (`warehouses.active = true`), descuenta `warehouse_stock` y `products`, verifica cupo de crédito para la fracción fiada, inserta filas en `sale_payments` antes del trigger contable (`acc_post_sale`), registra ingreso en `cash_entries` únicamente por el efectivo y dispara la contabilización NIIF con débitos desglosados por medio de pago.
- **Tablas afectadas:** `sales`, `sale_payments`, `products`, `warehouse_stock`, `warehouse_movements`, `kardex`, `cash_entries`, `acc_entries`, `acc_lines`.
- **Nivel de seguridad:** `SECURITY DEFINER`, `search_path` fijado, bloqueo idempotente por `client_uuid`, revocado a `anon`/`public`.

### 1.3 `registrar_pagos_venta(p_sale_id, p_payments, p_shift_id)`
- **Propósito:** Registra o reemplaza los renglones de pago (`sale_payments`) de una venta existente dentro de la empresa activa.
- **Tablas afectadas:** `sale_payments`, `sales`.
- **Nivel de seguridad:** `SECURITY DEFINER`, `search_path` fijado, revocado a `anon`/`public`.

### 1.4 `contabilizar_venta_automatica(p_sale_id)`
- **Propósito:** Genera de forma idempotente el asiento contable NIIF en `acc_entries`/`acc_lines` (vía `acc_system_entry`) para una venta completada leyendo sus pagos en `sale_payments` o `sales.payment_method`.
- **Tablas afectadas:** `acc_entries`, `acc_lines`, `acc_settings`, `acc_accounts`, `sale_payments`.
- **Nivel de seguridad:** `SECURITY DEFINER`, `search_path` fijado, revocado a `anon`/`public`.

### 1.5 `registrar_venta_bodega(p_customer_id, p_warehouse_id, p_items, p_payment_method, p_channel, p_client_id, p_captured_at)`
- **Propósito:** Variante multi-bodega con validación estricta de stock disponible en la bodega de origen.
- **Tablas afectadas:** `sales`, `warehouse_stock`, `warehouse_movements`, `kardex`.

### 1.6 `anular_venta(p_sale_id, p_reason)`
- **Propósito:** Revierte una venta previamente emitida, reincorpora los productos al inventario físico mediante movimiento inverso en kardex y reversa el asiento contable NIIF.
- **Tablas afectadas:** `sales`, `products`, `warehouse_stock`, `acc_entries`, `audit_logs`.

### 1.7 `registrar_abono(p_customer_id, p_amount, p_method, p_note, p_client_id)`
- **Propósito:** Registra un abono a cartera (FIFO sobre ventas con `payment_method = 'fiado'` o con renglón `'fiado'` parcial en `sale_payments`), descuenta la deuda calculada con `_sale_balance`, registra el ingreso en `cash_entries` vinculado al `shift_id` abierto si es efectivo y contabiliza vía `acc_post_payment`.
- **Tablas afectadas:** `credit_payments`, `credit_allocations`, `cash_entries`, `acc_entries`.

---

## 2. Caja y Control Antifraude

### 2.1 `caja_abrir_turno(p_opening_amount, p_warehouse_id, p_notes, p_denominations)`
- **Propósito:** Abre una sesión/turno de caja para el usuario autenticado (con `pg_advisory_xact_lock` por empresa y usuario), valida bodega activa (`warehouses.active = true`), registra la base inicial en `cash_entries` y guarda el desglose por denominaciones.
- **Tablas afectadas:** `cash_shifts`, `cash_entries`, `cash_shift_denominations`.

### 2.2 `caja_obtener_turno_activo()`
- **Propósito:** Retorna el turno abierto del cajero en la empresa en sesión con los totales autoritativos calculados desde servidor (`sales_cash`, `sales_card`, `sales_transfer`, `sales_credit`, `sales_count`, ingresos/egresos de caja y `expected_cash`).
- **Tablas consultadas:** `cash_shifts`, `sales`, `sale_payments`, `cash_entries`, `cash_shift_denominations`.

### 2.3 `caja_arqueo_ciego(p_shift_id, p_counted_cash, p_notes, p_denominations, p_is_final)`
- **Propósito:** Ejecuta arqueo parcial (`X`) o cierre ciego definitivo (`Z`) donde el cajero reporta el dinero físico contado sin ver totales esperados. Calcula diferencia sobre efectivo esperado, guarda registro inmutable en `cash_shift_arqueos`, genera alerta gerencial si hay descuadre y retorna el desglose autoritativo de servidor.
- **Tablas afectadas:** `cash_shifts`, `cash_shift_arqueos`, `cash_shift_denominations`, `manager_alerts`.

### 2.4 `caja_registrar_movimiento(p_shift_id, p_type, p_amount, p_concept)`
- **Propósito:** Registra ingresos extraordinarios o egresos menores de caja menor, vinculándolos al turno y a la contabilidad.
- **Tablas afectadas:** `cash_movements`, `cash_shifts`.

---

## 3. Inventario y Bodegas

### 3.1 `ajustar_stock(p_product_id, p_new_stock, p_reason)`
- **Propósito:** Ajuste directo de existencias con registro auditado en bitácora de inventarios y movimiento contable por merma o ajuste físico.
- **Tablas afectadas:** `products`, `kardex_movements`, `acc_entries`.

### 3.2 `crear_traslado_bodegas(p_origin_warehouse, p_dest_warehouse, p_items, p_notes)`
- **Propósito:** Inicia un traslado entre bodegas en estado 'en_transito', descontando de la bodega origen sin sumar a destino hasta la recepción.
- **Tablas afectadas:** `stock_transfers`, `warehouse_stock`.

### 3.3 `confirmar_traslado_bodegas(p_transfer_id, p_received_items)`
- **Propósito:** Confirma la recepción de mercancía en la bodega destino, registrando discrepancias si las unidades recibidas no coinciden.
- **Tablas afectadas:** `stock_transfers`, `warehouse_stock`, `kardex_movements`.

---

## 4. Contabilidad Regulatoria NIIF (`acc_*`)

### 4.1 `acc_trial_balance(p_from, p_to)`
- **Propósito:** Calcula el Balance de Prueba oficial por subcuenta PUC para el rango de fechas especificado, consolidando saldos iniciales, movimientos débitos, créditos y saldo final con control de partida doble.
- **Tablas afectadas:** `acc_accounts`, `acc_entries`, `acc_lines`.

### 4.2 `acc_balance_sheet(p_to)`
- **Propósito:** Genera el Balance General Clasificado a fecha de corte (Activos, Pasivos y Patrimonio).
- **Tablas afectadas:** `acc_accounts`, `acc_entries`, `acc_lines`.

### 4.3 `acc_income_statement(p_from, p_to)`
- **Propósito:** Genera el Estado de Resultados Integral (PyG: Ingresos operacionales, Costos de venta, Gastos de administración y Utilidad neta).
- **Tablas afectadas:** `acc_accounts`, `acc_entries`, `acc_lines`.

### 4.4 `acc_close_check(p_year, p_month)`
- **Propósito:** Auditoría previa al cierre de periodo mensual. Verifica que no existan asientos descuadrados, cuentas huérfanas ni transacciones en borrador.
- **Tablas consultadas:** `acc_entries`, `acc_lines`, `acc_periods`.

### 4.5 `acc_close_period(p_year, p_month, p_notes, p_ack)`
- **Propósito:** Cierra definitivamente el periodo contable, guarda snapshot en `acc_closings`, congela los asientos e impide cualquier modificación posterior salvo reapertura formal por dueño.
- **Tablas afectadas:** `acc_closings`, `acc_periods`.

### 4.6 `acc_reopen_period(p_year, p_month, p_reason)`
- **Propósito:** Reabre un periodo cerrado dejando rastro inmutable en auditoría con el usuario responsable y motivo detallado.
- **Tablas afectadas:** `acc_closings`, `acc_periods`, `audit_logs`.

---

## 5. Rutas y Fuerza de Ventas en Terreno

### 5.1 `mi_ruta_hoy(p_date)`
- **Propósito:** Retorna la secuencia ordenada de clientes y coordenadas asignadas al vendedor o repartidor autenticado para el día en curso.
- **Tablas consultadas:** `route_plans`, `route_stops`, `customers`.

### 5.2 `route_stop_set_status(p_stop, p_status)`
- **Propósito:** Actualiza el estado de una parada de ruta ('visitado', 'omitido', 'pendiente') con trazabilidad horaria.
- **Tablas afectadas:** `route_stops`.

---

## 6. Tributario DIAN (Colombia)

### 6.1 `dian_calcular_formulario_300(p_year, p_periodo, p_tipo_periodo)`
- **Propósito:** Consolida las bases gravables de IVA al 19%, 5%, 0% y exentos para la declaración bimestral o cuatrimestral de IVA DIAN.
- **Tablas consultadas:** `acc_entries`, `acc_lines`, `sales`, `purchases`.

### 6.2 `dian_generar_formato_1001(p_year)`
- **Propósito:** Prepara la información exógena DIAN correspondiente a pagos a terceros y retenciones practicadas.
- **Tablas consultadas:** `acc_lines`, `acc_accounts`, `customers`, `suppliers`.
