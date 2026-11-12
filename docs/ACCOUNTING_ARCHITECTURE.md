# INVENTARIOPRO — ARQUITECTURA CONTABLE NIIF OFICIAL (`acc_*`)

> **Documento Técnico de Referencia Especializada**  
> **Área:** Contabilidad y Finanzas Regulatorias  
> **Última actualización:** 2026-11-12  

---

## 1. El Modelo Oficial `acc_*`

La contabilidad de **InventarioPro / Contable Pro** se fundamenta en un sistema de partida doble estricta en tiempo real basado en el estándar NIIF para PYMES y la normativa tributaria colombiana (PUC comercial).

### 1.1 Principios Inviolables
1. **Un Solo Libro Contable:** Todo registro contable reside en `acc_entries` y `acc_lines`.
2. **Partida Doble Absoluta:** No existe transacción sin balance. La suma de débitos debe ser exactamente igual a la suma de créditos en cada asiento antes de su contabilización.
3. **Inmutabilidad Post-Registro:** Un asiento en estado `'contabilizado'` no puede modificarse ni eliminarse bajo ninguna circunstancia. Cualquier corrección requiere obligatoriamente un asiento de reverso (`acc_reverse_entry`).
4. **Cuentas Imputables (`is_postable = true`):** Los movimientos contables solo pueden afectar cuentas auxiliares de último nivel. Las cuentas de clase, grupo o cuenta mayor no admiten débitos ni créditos.
5. **Periodo Abierto:** No se permite asentar transacciones en meses que hayan sido cerrados formalmente mediante `acc_close_period`.

---

## 2. Esquema Relacional de Tablas

```
+-------------------------------------------------------------+
|                      acc_accounts                           |
+-------------------------------------------------------------+
| id (PK uuid)                                                |
| company_id (FK -> companies.id)                             |
| code (text, ej. '110505')                                   |
| name (text, ej. 'Caja General')                             |
| type (text: 'activo', 'pasivo', 'patrimonio', etc.)         |
| nature (text: 'debito', 'credito')                          |
| parent_id (FK -> acc_accounts.id, nullable)                 |
| is_postable (boolean, true para cuentas auxiliares)         |
| active (boolean)                                            |
+-------------------------------------------------------------+
                              ^
                              |
+--------------------+        |
|    acc_periods     |        |
+--------------------+        |
| company_id (PK)    |        |
| year (PK)          |        |
| month (PK)         |        |
| status ('abierto'  |        |
|        |'cerrado') |        |
+--------------------+        |
          ^                   |
          |                   |
+-------------------------------------------------------------+
|                       acc_entries                           |
+-------------------------------------------------------------+
| id (PK uuid)                                                |
| company_id (FK -> companies.id)                             |
| number (text, ej. 'AS-2026-0001')                           |
| entry_date (date)                                           |
| description (text)                                          |
| status ('borrador' | 'contabilizado' | 'reversado')         |
| source_type ('manual' | 'ajuste' | 'venta' | 'compra', etc.)|
| source_id (uuid, nullable)                                  |
| source_event (text)                                         |
| reverses_entry_id (FK -> acc_entries.id, nullable)          |
| created_by (FK -> auth.users.id)                            |
| posted_by (FK -> auth.users.id, nullable)                   |
| posted_at (timestamptz, nullable)                           |
+-------------------------------------------------------------+
          | 1
          |
          | n
+-------------------------------------------------------------+
|                        acc_lines                            |
+-------------------------------------------------------------+
| id (PK uuid)                                                |
| entry_id (FK -> acc_entries.id ON DELETE CASCADE)           |
| company_id (FK -> companies.id)                             |
| account_id (FK -> acc_accounts.id) -------------------------+
| debit (numeric(18,4), default 0)                            |
| credit (numeric(18,4), default 0)                           |
| memo (text, nullable)                                       |
+-------------------------------------------------------------+
```

---

## 3. Catálogo de Procedimientos Almacenados (RPC) y Contratos

### 3.1 `acc_create_entry`
- **Firma:** `(p_date date, p_description text, p_lines jsonb, p_post boolean default false, p_source_type text default 'manual', p_source_id uuid default null, p_event text default 'registro') RETURNS uuid`
- **Seguridad:** `SECURITY DEFINER`, `SET search_path = ''`.
- **Autorización:** `public.can_write_accounting()` (`dueno`, `admin_empresa`, `gerente`, `contador`).
- **Validaciones:**
  - `p_source_type` restringido estrictamente a `('manual', 'ajuste')`.
  - Idempotencia: si `p_source_id` ya existe con el mismo evento, retorna el `id` previo sin duplicar.
  - Obligatoriedad de fecha y descripción.
  - Validación de periodo abierto en `acc_period_is_open(v_c, p_date)`.
  - Inserta cabecera con consecutivo asignado por `acc_next_number(v_c, 'diario')` en estado `'borrador'`.
  - Itera sobre `p_lines` e inserta cada línea en `acc_lines`.
  - Si `p_post = true`, invoca internamente `acc_post_entry(v_id)`.

### 3.2 `acc_post_entry`
- **Firma:** `(p_entry_id uuid) RETURNS void`
- **Seguridad:** `SECURITY DEFINER`, `SET search_path = ''`.
- **Autorización:** `public.can_write_accounting()` (`dueno`, `admin_empresa`, `gerente`, `contador`).
- **Efecto:**
  - Actualiza el estado del asiento de `'borrador'` a `'contabilizado'`.
  - Registra `posted_by = auth.uid()` y `posted_at = now()`.
  - El trigger `acc_entries_guard` se dispara para verificar que `lines >= 2`, débitos = créditos y periodo abierto.

### 3.3 `acc_reverse_entry`
- **Firma:** `(p_entry_id uuid, p_reason text, p_date date default CURRENT_DATE) RETURNS uuid`
- **Seguridad:** `SECURITY DEFINER`, `SET search_path = ''`.
- **Autorización:** `public.is_manager()` (exclusivo para `dueno`, `admin_empresa`, `gerente`).
- **Efecto:**
  - Verifica que el asiento original esté en estado `'contabilizado'`.
  - Genera un nuevo asiento con consecutivo de reverso (`acc_next_number(v_c, 'reverso')`).
  - Invierte débitos y créditos de todas las líneas originales.
  - Marca el asiento nuevo como `'contabilizado'` y el original como `'reversado'`.

### 3.4 `acc_close_period`
- **Firma:** `(p_year int, p_month int, p_notes text default null, p_ack boolean default false) RETURNS uuid`
- **Seguridad:** `SECURITY DEFINER`, `SET search_path = ''`.
- **Autorización:** `public.is_manager()` (exclusivo para `dueno`, `admin_empresa`, `gerente`).
- **Efecto:**
  - Ejecuta chequeos previos en `acc_close_check(p_year, p_month)`. Si hay errores (asientos en borrador, descuadres), bloquea el cierre.
  - Registra el mes en `acc_periods` como `'cerrado'`.
  - Guarda snapshot completo en `acc_closings` con el balance de comprobación consolidado.

### 3.5 RPCs de Reportes Financieros
- `acc_trial_balance(p_from date, p_to date)`: Balance de comprobación por cuenta PUC con saldos iniciales, débitos, créditos y saldo neto final.
- `acc_balance_sheet(p_to date)`: Balance General clasificado (Activo, Pasivo, Patrimonio).
- `acc_income_statement(p_from date, p_to date)`: Estado de Resultados Integral (Ingresos, Costos, Gastos).
- `acc_ledger(p_account_id uuid, p_from date, p_to date)`: Libro mayor y auxiliar cronológico de una cuenta.

---

## 4. Matriz de Autorización Contable por Rol

| Operación | Dueño | Admin Empresa | Gerente | Contador | Vendedor / Cajero / Otros |
|---|:---:|:---:|:---:|:---:|:---:|
| **Consultar cuentas y asientos (SELECT RLS)** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Crear borrador (`acc_create_entry`, p_post=false)** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Postear asiento (`acc_post_entry` o p_post=true)** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Reversar asiento (`acc_reverse_entry`)** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Cerrar periodos fiscales (`acc_close_period`)** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Reabrir periodos fiscales (`acc_reopen_period`)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Configurar parámetros contables (`acc_settings`)** | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 5. Triggers de Integridad

### 5.1 `acc_entries_guard()`
1. En `INSERT`: Fuerza que el asiento nuevo siempre inicie con `status = 'borrador'`.
2. En `UPDATE`:
   - Si `old.status = 'contabilizado'`, prohíbe modificaciones, salvo la transición controlada a `'reversado'` vía `acc_reverse_entry`.
   - Si transiciona a `'contabilizado'`, exige:
     - `count(acc_lines) >= 2`.
     - `sum(debit) == sum(credit)` exacto.
     - `acc_period_is_open(company_id, entry_date) == true`.
3. En `DELETE`: Impide eliminar cualquier asiento que no esté en estado `'borrador'`.

### 5.2 `acc_lines_guard()`
1. En `INSERT` o `UPDATE`:
   - Verifica que el asiento padre esté en estado `'borrador'`.
   - Verifica que `new.company_id` y `v_acc.company_id` coincidan con la empresa del asiento padre.
   - Exige que la cuenta contable esté activa (`active = true`) y sea imputable (`is_postable = true`).
2. En `DELETE`: Impide borrar líneas de un asiento que ya ha sido contabilizado.

---

## 6. Aislamiento Multi-Tenant

- El acceso a las tablas `acc_*` por SELECT se rige por:
  ```sql
  ((company_id = current_company_id()) AND can_view_accounting())
  ```
- Ninguna RPC confía en el `company_id` enviado por parámetros desde el cliente; resuelven la compañía autenticada mediante:
  ```sql
  v_c := public.my_company(); -- SELECT company_id FROM public.profiles WHERE id = auth.uid()
  ```
- Triggers de integridad verifican que cada línea contable pertenezca a la misma `company_id` del asiento.

---

## 7. Restricciones para Cambios Futuros

1. **Prohibido:** Modificar la firma o contratos de las RPC `acc_*` sin plan de migración formal y actualización de `docs/RPC_CATALOG.md`.
2. **Prohibido:** Reintroducir tablas legacy como `accounts`, `journal_entries`, `journal_lines`.
3. **Prohibido:** Retirar o relajar los triggers de inmutabilidad `acc_entries_guard` y `acc_lines_guard`.
4. **Prohibido:** Otorgar permisos de reversión o cierre contable a roles operativos o externos sin autorización explícita de la dirección.
