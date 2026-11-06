import { serve } from "bun";
import { supabase } from "./src/lib/supabase";

// Configuración del servidor con Bun
serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
    const url = new URL(req.url);

    // Configuración de cabeceras CORS para permitir la comunicación con el frontend
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Content-Type": "application/json",
    };

    // Manejo de peticiones OPTIONS (Preflight de CORS)
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. Endpoint: Obtener Balance de Comprobación vía API
      if (url.pathname === "/api/accounting/trial-balance" && req.method === "GET") {
        const startDate = url.searchParams.get("startDate");
        const endDate = url.searchParams.get("endDate");

        if (!startDate || !endDate) {
          return new Response(
            JSON.stringify({ error: "Faltan los parámetros startDate y endDate" }), 
            { status: 400, headers: corsHeaders }
          );
        }

        // Llamada directa a la función RPC que creamos en Supabase
        const { data, error } = await supabase.rpc("get_trial_balance", {
          p_start_date: startDate,
          v_end_date: endDate
        });

        if (error) throw error;

        return new Response(JSON.stringify({ success: true, data }), { headers: corsHeaders });
      }

      // 2. Endpoint: Registrar un nuevo asiento contable (Estructura segura)
      if (url.pathname === "/api/accounting/journal-entry" && req.method === "POST") {
        const body = await req.json();
        const { concept, entry_date, lines } = body;

        if (!concept || !entry_date || !lines || !Array.isArray(lines)) {
          return new Response(
            JSON.stringify({ error: "Estructura de payload contable inválida" }), 
            { status: 400, headers: corsHeaders }
          );
        }

        // Transacción: Insertar cabecera
        const { data: entry, error: entryError } = await supabase
          .from("accounting_journal_entries")
          .insert([{ concept, entry_date, status: "DRAFT" }])
          .select()
          .single();

        if (entryError) throw entryError;

        // Estructurar líneas asociadas al ID de la cabecera recién creada
        const linesToInsert = lines.map((line: any) => ({
          entry_id: entry.id,
          account_id: line.accountId,
          debit: line.debit || 0,
          credit: line.credit || 0
        }));

        const { error: linesError } = await supabase
          .from("accounting_journal_items")
          .insert(linesToInsert);

        if (linesError) throw linesError;

        return new Response(
          JSON.stringify({ success: true, message: "Asiento diario registrado en el servidor", entryId: entry.id }), 
          { headers: corsHeaders }
        );
      }

      // Ruta no encontrada
      return new Response(JSON.stringify({ error: "Endpoint no encontrado" }), { status: 404, headers: corsHeaders });

    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: "Internal Server Error", details: err.message }), 
        { status: 500, headers: corsHeaders }
      );
    }
  },
});

console.log(`🚀 Servidor ERP Bun Contable corriendo en el puerto ${process.env.PORT || 3000}`);
