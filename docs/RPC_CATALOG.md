# Catálogo de Procedimientos Almacenados (RPC) Críticos

**Sistema:** Contable Pro (ERP Financiero, Comercial y Contable)  
**Fecha de corte:** 2026-11-10  
**Arquitectura:** PostgreSQL + Supabase (Multi-tenant con `company_id` y RLS al 100%)

---

## 1. Ciclo Comercial y Facturación

### 1.1 `registrar_venta(p_customer_id, p_items, p_payment_method, p_channel, p_client_id, p_captured_at)`
- **Propósito:** Registra una venta en mostrador o ruta, descuenta inventario en la bodega activa, crea comprobante fiscal (`invoice_number`) y dispara el asiento contable (`acc_entries` / `acc_lines`) de partida doble (Caja/Bancos vs Ingresos e IVA).
- **Tablas afectadas:** `sales`, `sale_items`, `products`, `acc_entries`, `acc_lines`, `cash_shifts`.
- **Nivel de seguridad:** SECURITY DEFINER, valida `company_id` contra `auth.uid()`.

### 1.2 `registrar_venta_bodega(p_customer_id, p_warehouse_id, p_items, p_payment_method, p_channel, p_client_id, p_captured_at)`
- **Propósito:** Variante multi-bodega con validación estricta de stock disponible en la bodega de origen.
- **Tablas afectadas:** `sales`, `sale_items`, `warehouse_stock`, `kardex_movements`.

### 1.3 `anular_venta(p_sale_id, p_reason)`
- **Propósito:** Revierte una venta previamente emitida, reincorpora los productos al inventario físico mediante movimiento inverso en kardex y reversa el asiento contable NIIF.
- **Tablas afectadas:** `sales`, `products`, `warehouse_stock`, `acc_entries`, `audit_logs`.

---

## 2. Caja y Control Antifraude

### 2.1 `caja_abrir_turno(p_branch_id, p_base_amount, p_notes)`
- **Propósito:** Abre una sesión/turno de caja para el usuario actual, registrando la base en efectivo inicial y asegurando que no tenga turnos concurrentes huérfanos.
- **Tablas afectadas:** `cash_shifts`, `cash_movements`.

### 2.2 `caja_arqueo_ciego(p_shift_id, p_cash_counted, p_voucher_counted, p_notes)`
- **Propósito:** Permite el cierre ciego donde el cajero reporta el dinero físico contado sin ver los totales del sistema. El sistema calcula el sobrante/faltante y genera la alerta para el Gerente o Administrador.
- **Tablas afectadas:** `cash_shifts`, `manager_alerts`.

### 2.3 `caja_registrar_movimiento(p_shift_id, p_type, p_amount, p_concept)`
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
