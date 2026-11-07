// Servidor ERP contable sobre Bun.
// Ejecutar:  bun run server.ts   (desarrollo: bun --watch server.ts)
//
// Usa el modelo contable vigente (acc_*) a través de sus funciones RPC. Esas funciones validan
// permisos con la sesión del usuario, así que cada petición debe traer el encabezado
//   Authorization: Bearer <token de sesión de Supabase>
// y el servidor se lo reenvía a Supabase (nunca usa una llave con privilegios elevados).
import { serve, env } from "bun";
import { createClient } from "@supabase/supabase-js";
import path from "path";

const SUPABASE_URL = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
const SUPABASE_ANON_KEY = (env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || "").trim();

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Cliente de Supabase que actúa con la sesión del usuario que llama. */
function clientFor(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function rpcError(err: { message?: string }): Response {
  const msg = err?.message || "Error de base de datos";
  const status = /no autorizado|permission denied|jwt/i.test(msg) ? 403 : 400;
  return json({ success: false, error: msg }, status);
}

serve({
  port: Number(env.PORT) || 3000,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Preflight de CORS
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // 1. Health check de servidor
      if (url.pathname === "/api/health" && req.method === "GET") {
        return json({ ok: true, runtime: "bun", supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) });
      }

      // 2. Si la ruta NO empieza por /api, servir la SPA estática desde dist
      if (!url.pathname.startsWith("/api")) {
        const cleanPath = url.pathname.replace(/^\/+/, "");
        if (cleanPath) {
          const filePath = path.join(process.cwd(), "dist", cleanPath);
          const file = (globalThis as any).Bun?.file ? (globalThis as any).Bun.file(filePath) : null;
          if (file && (await file.exists())) {
            return new Response(file);
          }
        }

        // Fallback SPA (index.html)
        const indexPath = path.join(process.cwd(), "dist", "index.html");
        const indexFile = (globalThis as any).Bun?.file ? (globalThis as any).Bun.file(indexPath) : null;
        if (indexFile && (await indexFile.exists())) {
          return new Response(indexFile, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        return json({ success: false, error: "Frontend no compilado. Ejecuta npm run build" }, 404);
      }

      if (!url.pathname.startsWith("/api/accounting/")) {
        return json({ success: false, error: "Endpoint no encontrado" }, 404);
      }

      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        return json({ success: false, error: "Servidor sin SUPABASE_URL / SUPABASE_ANON_KEY configurados" }, 503);
      }

      const db = clientFor(req);
      if (!db) return json({ success: false, error: "Falta el token de sesión (Authorization: Bearer ...)" }, 401);

      // 1) Balance de comprobación
      if (url.pathname === "/api/accounting/trial-balance" && req.method === "GET") {
        const startDate = url.searchParams.get("startDate");
        const endDate = url.searchParams.get("endDate");
        if (!isDate(startDate) || !isDate(endDate)) {
          return json({ success: false, error: "startDate y endDate son obligatorios (AAAA-MM-DD)" }, 400);
        }
        const { data, error } = await db.rpc("acc_trial_balance", { p_from: startDate, p_to: endDate });
        if (error) return rpcError(error);
        return json({ success: true, data });
      }

      // 2) Balance general
      if (url.pathname === "/api/accounting/balance-sheet" && req.method === "GET") {
        const endDate = url.searchParams.get("endDate");
        if (!isDate(endDate)) return json({ success: false, error: "endDate es obligatorio (AAAA-MM-DD)" }, 400);
        const { data, error } = await db.rpc("acc_balance_sheet", { p_to: endDate });
        if (error) return rpcError(error);
        return json({ success: true, data });
      }

      // 3) Estado de resultados
      if (url.pathname === "/api/accounting/income-statement" && req.method === "GET") {
        const startDate = url.searchParams.get("startDate");
        const endDate = url.searchParams.get("endDate");
        if (!isDate(startDate) || !isDate(endDate)) {
          return json({ success: false, error: "startDate y endDate son obligatorios (AAAA-MM-DD)" }, 400);
        }
        const { data, error } = await db.rpc("acc_income_statement", { p_from: startDate, p_to: endDate });
        if (error) return rpcError(error);
        return json({ success: true, data });
      }

      // 4) Plan de cuentas
      if (url.pathname === "/api/accounting/accounts" && req.method === "GET") {
        const { data, error } = await db
          .from("acc_accounts")
          .select("id, code, name, type, nature, parent_id, is_postable, active")
          .order("code", { ascending: true });
        if (error) return rpcError(error);
        return json({ success: true, data });
      }

      // 5) Registrar un asiento (borrador, o contabilizado si post = true)
      if (url.pathname === "/api/accounting/journal-entry" && req.method === "POST") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object") return json({ success: false, error: "Cuerpo JSON inválido" }, 400);

        const date = (body as any).entry_date ?? (body as any).date;
        const description = String((body as any).concept ?? (body as any).description ?? "").trim();
        const post = (body as any).post === true;
        const rawLines = (body as any).lines;

        if (!isDate(date) || !description || !Array.isArray(rawLines)) {
          return json({ success: false, error: "Estructura de asiento inválida: fecha, concepto y líneas son obligatorios" }, 400);
        }
        if (rawLines.length < 2) {
          return json({ success: false, error: "Un asiento necesita al menos dos líneas" }, 400);
        }

        let totalDebit = 0;
        let totalCredit = 0;
        const lines: Array<{ account_id: string; debit: number; credit: number; memo: string | null }> = [];
        for (const l of rawLines) {
          const accountId = l?.account_id ?? l?.accountId;
          const debit = Number(l?.debit ?? 0);
          const credit = Number(l?.credit ?? 0);
          if (!isUuid(accountId)) return json({ success: false, error: "Cada línea necesita un account_id válido" }, 400);
          if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
            return json({ success: false, error: "Débito y crédito deben ser números no negativos" }, 400);
          }
          if ((debit > 0 && credit > 0) || (debit === 0 && credit === 0)) {
            return json({ success: false, error: "Cada línea debe tener débito o crédito, no ambos ni ninguno" }, 400);
          }
          totalDebit += debit;
          totalCredit += credit;
          lines.push({ account_id: accountId, debit, credit, memo: l?.memo ? String(l.memo) : null });
        }
        if (Math.abs(totalDebit - totalCredit) > 0.004) {
          return json({ success: false, error: `Asiento descuadrado: débitos ${totalDebit.toFixed(2)} ≠ créditos ${totalCredit.toFixed(2)}` }, 422);
        }

        const { data, error } = await db.rpc("acc_create_entry", {
          p_date: date,
          p_description: description,
          p_lines: lines,
          p_post: post,
        });
        if (error) return rpcError(error);
        return json({ success: true, message: post ? "Asiento contabilizado" : "Asiento guardado como borrador", entryId: data }, 201);
      }

      return json({ success: false, error: "Endpoint no encontrado" }, 404);
    } catch (err: any) {
      return json({ success: false, error: "Internal Server Error", details: err?.message }, 500);
    }
  },
});

console.log(`🚀 Servidor ERP Bun contable en el puerto ${env.PORT || 3000}`);
