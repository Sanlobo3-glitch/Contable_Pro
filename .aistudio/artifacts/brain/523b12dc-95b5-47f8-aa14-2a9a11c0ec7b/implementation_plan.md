# Plan de Consolidación: Ciclo Comercial, Ventas, Cartera y Arqueos de Caja

Plan maestro para consolidar, robustecer y blindar operativamente el núcleo de mayor impacto transaccional en Contable Pro: el flujo continuo desde la venta en mostrador (POS), la facturación y cobranza a crédito (cartera), hasta el control de turnos y arqueos ciegos de caja, enlazado de forma automática con la contabilidad de partida doble NIIF (`acc_*`) y la DIAN.

---

### Decisiones Críticas y Resumen de Preferencias

> [!IMPORTANT]
> **Pilar Estratégico Confirmado**: Se prioriza la consolidación integral del **Ciclo Comercial y Caja (POS, Ventas, Cartera y Arqueos)** como la columna vertebral de alta rotación y flujo de caja del negocio.
>
> **Directrices de Operación Aplicadas**:
> 1. **Control Antifraude Estricto con Bypass Gerencial**: Bloqueo preventivo de inventario negativo en mostrador y límite estricto de descuentos al cajero/vendedor, con mecanismo de autorización por PIN o token gerencial cuando una operación justificada lo requiera.
> 2. **Enlace Contable en Doble Modalidad**: Enlace automático en tiempo real para ventas de contado y crédito a cuentas predeterminadas (`acc_*`), sumado a una conciliación diaria del comprobante de Cierre Z de caja para garantizar concordancia absoluta entre el efectivo físico y el libro diario contable.

---

### 1. Visión General y Alcance del Núcleo Operativo

El ciclo comercial y de caja representa más del 80% del volumen diario de datos de cualquier empresa comercial o de servicios. La consolidación asegura:

1. **POS / Mostrador de Alta Velocidad**:
   - Agilidad en caja para terminales táctiles y móviles: lector de código de barras continuo, búsqueda instantánea de productos y clientes, y panel numérico de cobro rápido.
   - Multipagos combinados (efectivo, transferencias Nequi/Daviplata/bancarias, tarjeta débito/crédito y crédito fiado).
   - Generación de tickets térmicos formateados para impresoras de 58mm y 80mm con código QR de resolución DIAN.

2. **Gestión de Ventas y Trazabilidad Operativa**:
   - Consecutivos oficiales por sucursal y terminal.
   - Manejo de notas crédito, devoluciones totales/parciales con restitución selectiva a bodega y reversión en kardex.
   - Auditoría de anulaciones con registro obligatorio de motivo y responsable.

3. **Módulo de Cartera (Cuentas por Cobrar / Fiado)**:
   - Política de crédito por cliente (cupo máximo asignado y plazo en días).
   - Validación automática en mostrador antes de permitir venta a crédito.
   - Registro de recibos de caja / abonos con imputación a facturas específicas o a la más antigua.
   - Estados de cuenta descargables para compartir al cliente por WhatsApp o PDF.

4. **Turnos de Caja y Arqueos Ciegos (Cierres X y Z)**:
   - Apertura de turno formalizada con fondo fijo inicial asignado al cajero.
   - Arqueo ciego: el cajero cuenta físicamente billetes y monedas sin conocer el monto teórico acumulado por el sistema, previniendo manipulaciones.
   - Detección instantánea de diferencias (faltantes o sobrantes) y generación de recibo de cierre Z inmutable con firma digital del supervisor.

5. **Consolidación Contable NIIF (`acc_*`)**:
   - Cada cobro, factura y abono afecta automáticamente las cuentas maestras de activo, pasivo tributario e ingresos sin intervención manual ni duplicación de asientos.

---

### 2. Experiencia de Usuario y Diseño de Interfaz

Siguiendo los lineamientos de diseño corporativo y anti-slop para aplicaciones SaaS de misión crítica:

- **Estructura del Espacio de Trabajo**:
  - Encabezado unificado con indicador de turno de caja activo (número de terminal, cajero en turno, hora de apertura y botón de corte rápido).
  - Distribución de pantalla POS a dos columnas balanceadas: panel de búsqueda/catálogo visual a la izquierda ($60\%$) y canasta de venta con resumen numérico vertical a la derecha ($40\%$).
- **Tratamiento Tipográfico y Cifras**:
  - Todas las sumas monetarias, cantidades, códigos de barra y porcentajes formateados estrictamente con cifras tabulares monoespaciadas (`font-mono tabular-nums`) para evitar oscilaciones visuales al modificar cantidades.
  - Supresión total de pastillas/chips estáticos de colores estridentes; visualización de metadatos limpios con separadores tipográficos (`·`).
- **Flujos Operativos Clave**:
  1. **Flujo Mostrador (POS)**: Foco automático en buscador $\rightarrow$ Selección o escaneo $\rightarrow$ Tecla de atajo F2 o botón "Cobrar" $\rightarrow$ Modal de medios de pago con cálculo automático de cambio/vueltas $\rightarrow$ Impresión de ticket y retorno automático a canasta vacía en menos de 1 segundo.
  2. **Flujo Arqueo de Caja**: Clic en "Cerrar Turno" $\rightarrow$ Matriz de desglose de denominaciones de moneda colombiana ($100.000$, $50.000$, $20.000$, $10.000$, etc.) $\rightarrow$ Registro de conteo $\rightarrow$ Apertura de reporte comparativo con desglose por medios de pago $\rightarrow$ Asiento contable de cierre.
  3. **Flujo Abono a Cartera**: Búsqueda del cliente $\rightarrow$ Vista de facturas vencidas ordenadas por antigüedad $\rightarrow$ Captura del valor recibido y medio de cobro $\rightarrow$ Generación de comprobante de ingreso y actualización inmediata del cupo disponible.

---

### 3. Decisiones Arquitectónicas y Compromisos Técnicos

- **Decisión 1: Manejo de Sesiones de Caja Estructuradas (`cash_shifts`)**
  - *Enfoque*: Cada cajero opera bajo un registro explícito de turno con marca de tiempo, base inicial, cajero responsable y estado (`open`, `closing`, `closed`). Las ventas quedan vinculadas a su respectivo `shift_id`.
  - *Razón*: Elimina la ambigüedad de cierres por simple fecha/hora, permitiendo múltiples turnos al día en una misma terminal con arqueos independientes.
  - *Alternativa descartada*: Cierres genéricos basados en rangos horarios del día calendario, los cuales generan descuadres cuando un turno sobrepasa la medianoche.

- **Decisión 2: Arqueo Ciego vs Arqueo Abierto**
  - *Enfoque*: Implementar modo ciego predeterminado donde el cajero ingresa las cantidades físicas sin ver el total calculado por el sistema hasta después de guardar su conteo.
  - *Razón*: Mitiga el riesgo de hurto o ajuste artificial de fondos en efectivo por parte del personal de caja.

- **Decisión 3: Enlace Directo con el Modelo Contable `acc_*`**
  - *Enfoque*: Aprovechar los endpoints y procedimientos existentes de `acc_entries` y `acc_lines` para generar automáticamente los asientos contables en cuentas 1105 (Caja General), 1110 (Bancos/Plataformas), 1305 (Clientes/Cartera), 4135 (Comercio al por mayor y menor) y 2408 (IVA por pagar).
  - *Razón*: Cumple con la regla innegociable de no crear esquemas contables obsoletos y garantiza estados financieros NIIF siempre al día.

---

### 4. Arquitectura del Sistema y Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       INTERFAZ DE USUARIO (REACT SPA)                       │
├──────────────────────┬──────────────────────┬───────────────────────────────┤
│    MOSTRADOR POS     │   CARTERA Y FIADOS   │       ARQUEOS DE CAJA         │
│  - Catálogo/Lector   │  - Cupos de crédito  │  - Apertura con fondo base    │
│  - Canasta y Totales │  - Facturas por cobrar│ - Matriz de denominaciones    │
│  - Modal Multipagos  │  - Recibos de caja   │  - Reporte de diferencias X/Z │
└──────────┬───────────┴──────────┬───────────┴───────────────┬───────────────┘
           │                      │                           │
           ▼                      ▼                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CAPA DE SERVICIOS Y ORQUESTACIÓN (FRONTEND)                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  • posCheckoutService.ts    : Validación de stock, cálculos y pagos          │
│  • cashShiftService.ts      : Control de aperturas, cierres y desglose      │
│  • carteraService.ts        : Control de saldo, mora y aplicaciones         │
│  • accountingBridgeService  : Mapeo y generación de asientos contables      │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                 MOTOR DE PERSISTENCIA Y SEGURIDAD (POSTGRES)                │
├─────────────────────────────────────────────────────────────────────────────┤
│  • Tablas Operativas: sales, sale_items, cash_shifts, cash_denominations,   │
│                       customer_credit_limits, payment_receipts              │
│  • Tablas Contables: acc_entries, acc_lines, acc_accounts (NIIF Oficial)    │
│  • Seguridad: RLS activo con company_id en todas las tablas transaccionales │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Fases de Ejecución

1. **Fase 1: Módulo de Turnos y Arqueos de Caja (`cash_shifts`)**
   - Asegurar tabla de turnos de caja y desglose de billetes/monedas.
   - Interfaz de conteo ciego con soporte de denominaciones colombianas.
   - Comprobante imprimible de Cierre Z con desglose por medio de pago.

2. **Fase 2: Optimización del POS y Multipagos**
   - Panel de cobro rápido con cálculo instantáneo de vueltas.
   - Soporte para pagos mixtos (ej. 50% Efectivo, 50% Transferencia).
   - Validación en tiempo real de cupo de crédito para ventas fiadas.

3. **Fase 3: Consolidación de Cartera**
   - Interfaz de recaudos y recibos de caja con afectación de saldo en vivo.
   - Historial de cobranza y cálculo de mora en días.

4. **Fase 4: Contabilización Automática (`acc_*`)**
   - Integración automática de cada venta y recibo de caja en el libro diario.
   - Verificación de consistencia y balance cuadrado débito = crédito.
