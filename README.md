# InventarioPro — Contable Pro

SaaS multiempresa de inventario, ventas, compras, caja y **contabilidad de partida doble**
sobre Supabase/PostgreSQL.

> ## ⚠️ Antes de tocar este repositorio
> **Lee [`AGENTS.md`](./AGENTS.md).** Contiene el estado real de la base de datos, el flujo de
> venta, el procedimiento de migraciones y las trampas conocidas. Está pensado para que no
> tengas que reconstruir el contexto a base de leer el código.

## Stack

React 19 · TypeScript 7 · Vite 8 · Tailwind 4 · TanStack Query 5 · Supabase (PostgreSQL 17) · Bun

## Arranque

```bash
npm install
cp .env.example .env     # y rellena SUPABASE_URL / VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm run dev              # servidor Bun con la API (http://localhost:3000)
```

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor Bun en modo watch (`server.ts`) |
| `npm run build` | Build de producción con Vite (no type-chequea) |
| `npm run lint` | Type-check con `tsc --noEmit` |
| `npm run preview` | Sirve el build |
| `npm run start` | Servidor Bun sin watch |

Sin credenciales de Supabase la app arranca en **modo demo** con un mock en memoria
(`src/lib/supabase.ts`).

## Migraciones de base de datos

Se aplican **a mano** desde el SQL Editor de Supabase, en el orden que indica
[`supabase/migrations/README.md`](./supabase/migrations/README.md).

> **Nunca uses `supabase db push`** — el historial de la BD usa timestamps del Dashboard y el
> CLI los compararía contra los nombres de archivo del repo, con lo que reintentaría todo.
> El detalle está en [`AGENTS.md` §6](./AGENTS.md#6-migraciones-se-aplican-a-mano).

## Bitácora de SQL

Cada ejecución de SQL hecha desde la app queda registrada en `public.sql_migration_log` con el
SQL exacto, su hash SHA-256, el error si lo hubo, la duración, el origen y el archivo de
migración asociado. Ver [`AGENTS.md` §7](./AGENTS.md#7-bitácora-de-sql-migración-000049).

## Estructura

```
src/pages/      77 páginas (una por módulo)
src/components/ componentes de UI,incluidos los contables
src/lib/        auth, cliente Supabase + mock, cola offline, utilidades de reporte, Impuestos…
src/services/   capa de servicios
api/            funciones serverless de Vercel
supabase/       migraciones, migraciones reemplazadas y scripts de auditoría
```

## Licencia

Propietario. Todos los derechos reservados.
