# Contable Pro (InventarioPro) — Sistema contable e inventario para empresas

SaaS multiempresa: inventario multibodega, ventas/POS, compras, cartera y cuentas por pagar, nómina, tesorería, logística (flota y rutas), catálogo público y **contabilidad de partida doble**.
Stack: Vite + React 19 + TypeScript + Tailwind 4 · Supabase (Postgres + RLS + RPC) · Vercel (`vite build`) · servidor opcional en **Bun** (`server.ts`).

## Para una IA nueva — empieza aquí (2 minutos)
1. Lee **`supabase/MIGRATIONS.md`**: reglas, estado real de la base, migraciones y cómo registrar SQL.
2. Estado vivo de la base: `select * from public.sql_migration_log order by executed_at desc;`
3. **Un solo libro contable (`acc_*`)**. No crear `accounts`/`journal_*`/`fn_*`.
4. Los documentos de `supabase/audits/` son históricos; no reflejan el estado actual.
5. Todo SQL nuevo: archivo en `supabase/migrations/` + pie de registro + fila en `MIGRATIONS.md`.

## Estructura
- `src/pages/` pantallas por módulo · `src/components/` UI (incl. `logistics/`) · `src/lib/` (auth, navegación y roles en `navigation.ts`/`auth.tsx`, paquetes SQL en `sqlScripts.ts`).
- `api/` funciones serverless de Vercel (`copilot`, `document-scanner`, `store-preview`, `admin-sql`).
- `supabase/migrations/` historial SQL · `supabase/migrations_superseded/` descartadas · `supabase/audits/` informes.

## Roles
`admin`/`super_admin` (administrador central; Centro SQL solo para la cuenta maestra), `gerente`, `contador`, `vendedor` y roles de soporte técnico. El acceso por página se define en `src/lib/navigation.ts`.

## Comandos
`bun install` · `bun run build` (Vercel) · `bun --watch server.ts` (servidor Bun, requiere `SUPABASE_URL` y `SUPABASE_ANON_KEY`) · `bun run lint`.
