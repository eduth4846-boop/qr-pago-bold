// supabase/functions/bold-crear-orden/index.ts
//
// Crea la "solicitud_compra" en estado pendiente_pago, reserva los asientos
// y calcula la firma de integridad de Bold (SHA256) usando la llave secreta,
// que NUNCA se envía al navegador del comprador.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOLD_IDENTITY_KEY = Deno.env.get("BOLD_IDENTITY_KEY")!;
const BOLD_SECRET_KEY = Deno.env.get("BOLD_SECRET_KEY")!;
const SITE_URL = Deno.env.get("SITE_URL")!; // ej: https://tu-dominio.com/index.html

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { evento_id, sala, nombre, cedula, correo, telefono, items, total } = body;

    if (!evento_id || !Array.isArray(items) || !items.length || !total || Number(total) <= 0) {
      return new Response(JSON.stringify({ error: "Datos de compra incompletos" }), { status: 400, headers: corsHeaders });
    }
    if (!nombre || !cedula || !correo || !telefono) {
      return new Response(JSON.stringify({ error: "Faltan datos del comprador" }), { status: 400, headers: corsHeaders });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Verifica que los asientos sigan disponibles antes de cobrar
    const asientoIds = items.filter((it: any) => it.asiento_id).map((it: any) => it.asiento_id);
    if (asientoIds.length) {
      const { data: asientos } = await sb.from("asientos").select("id,ocupado").in("id", asientoIds);
      const ocupado = (asientos || []).find((a: any) => a.ocupado);
      if (ocupado) {
        return new Response(JSON.stringify({ error: "Una de las ubicaciones seleccionadas ya no está disponible" }), { status: 409, headers: corsHeaders });
      }
    }

    const order_id = `GLM${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const amount = String(Math.round(Number(total)));
    const currency = "COP";

    const { data: sol, error } = await sb
      .from("solicitudes_compra")
      .insert({
        evento_id, sala, nombre, cedula, correo, telefono,
        items, total, estado: "pendiente_pago",
        metodo_pago: "bold", bold_order_id: order_id,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    }

    // Reserva los asientos mientras se completa el pago
    await Promise.all(
      asientoIds.map((id: string) => sb.from("asientos").update({ ocupado: true }).eq("id", id))
    );

    const integrity_signature = await sha256Hex(`${order_id}${amount}${currency}${BOLD_SECRET_KEY}`);

    return new Response(
      JSON.stringify({
        solicitud_id: sol.id,
        order_id,
        amount,
        currency,
        api_key: BOLD_IDENTITY_KEY,
        integrity_signature,
        redirection_url: `${SITE_URL}?bold_order_id=${order_id}`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
