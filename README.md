# Contable Pro — ERP SaaS Multiempresa

Sistema contable y de gestión empresarial (ERP SaaS multi-tenant) para pequeñas y medianas empresas en Latinoamérica (con enfoque regulatorio para Colombia).

- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS 4, Motion.
- **Backend & Base de Datos:** Supabase (PostgreSQL 17, RLS en todas las tablas, RPCs, Edge Functions).
- **Servidor:** Bun (`server.ts`) y Serverless functions (`/api` para Vercel).
- **Inteligencia Artificial:** Google Gemini (escáneres de facturas/comprobantes, Copilot empresarial, diagnósticos deterministas).
- **Modelo Contable:** Partida doble estricto bajo estándar PUC NIIF con prefijo `acc_*`.

---

## 1. Reglas No Negociables para Desarrolladores y Agentes IA

1. **Modelo Contable Único (`acc_*`):**
   - Tablas contables autorizadas: `acc_accounts`, `acc_entries`, `acc_lines`, `acc_periods`, `acc_closings`, `acc_settings`, `acc_counters`.
   - **Terminantemente prohibido** crear o referenciar tablas legacy como `accounts`, `journal_entries`, `journal_lines` o funciones `fn_*`.
2. **Migraciones Idempotentes:**
   - Todo cambio a la base de datos debe ir en `supabase/migrations/` como script idempotente (sin `BEGIN`/`COMMIT`).
   - Cada migración debe terminar con la llamada a `public.sql_registrar_migracion(...)` y estar documentada en `supabase/MIGRATIONS.md`.
3. **Control de Accesos y Permisos por Rol:**
   - La **fuente única de verdad** de permisos es `src/lib/pagePermissions.ts`.
   - Consulta `docs/PERMISOS_POR_ROL.md` para la matriz legible por humanos. No insertar comprobaciones de rol aisladas en componentes ni menús.
4. **Aislamiento Multiempresa Estricto (Multi-tenant):**
   - Toda tabla y consulta operacional debe incluir `company_id`. RLS habilitado al 100%.
   - En funciones `SECURITY DEFINER`, siempre declarar `SET search_path = public`.

---

## 2. Estructura de Directorios

- `src/pages/`: Pantallas de módulos (POS, Ventas, Compras, Inventario, Cartera, Tesorería, Contabilidad PUC, Centro Gerencial, etc.).
- `src/components/`: Componentes UI modulares, layouts y navegación (`AppLayout.tsx`).
- `src/lib/`:
  - `pagePermissions.ts`: Reglas maestras de permisos por rol.
  - `auth.tsx`: Proveedor de autenticación, sesión y simulación de roles ("Paso Maestro").
  - `sqlScripts.ts`: Paquetes SQL para el Centro de Scripts y diagnóstico de esquemas.
  - `currency.ts`: Formateo de moneda y conversiones.
- `src/services/`: Capa de servicios para comunicación con Supabase y lógica de agregación (ej. `managerService.ts`).
- `supabase/migrations/`: Scripts SQL idempotentes numerados y versionados.
- `supabase/MIGRATIONS.md`: Historial y registro de verificación de migraciones.
- `api/`: Funciones serverless de integración (Copilot, escáner de documentos, admin-sql).

---

## 3. Roles del Sistema

- **Administrador de Plataforma (`super_admin` / `admin`):** Gestión central de empresas clientes, planes SaaS y Centro SQL maestro.
- **Dueño (`dueno`):** Propietario de empresa. Facturación SaaS, configuración legal/fiscal, sedes y delegación gerencial.
- **Gerente General / Operativo (`gerente`):** Centro de Dirección Gerencial (10 módulos ejecutivos, autorizaciones, planes de acción, supervisión ERP integral).
- **Contador Público (`contador`):** Despacho contable, PUC NIIF, comprobantes de diario, estados financieros, balances, conciliación e impuestos.
- **Roles Operativos:** `vendedor` (POS, rutas, clientes), `cajero` (arqueos, mostrador), `almacen` (kardex, multibodega, tomas físicas), `transportador` (rutas, entregas).
