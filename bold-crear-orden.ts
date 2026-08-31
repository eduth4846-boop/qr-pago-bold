import { corsHeaders, json, sha256Hex, supabaseAdmin, cleanOrderId } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const body = await req.json();
    const { evento_id, sala, nombre, cedula, correo, telefono, items, total } = body ?? {};

    if (!evento_id || !nombre || !cedula || !correo || !Array.isArray(items) || items.length === 0) {
      return json({ error: 'Faltan datos obligatorios de la compra.' }, 400);
    }

    const amount = Math.round(Number(total));
    if (!Number.isFinite(amount) || amount < 1000) {
      return json({ error: 'El monto debe ser un número y cumplir el mínimo de $1.000 COP.' }, 400);
    }

    const sb = supabaseAdmin();

    // Verifica que el evento exista.
    const { data: evento, error: eventoError } = await sb.from('eventos').select('id,nombre').eq('id', evento_id).maybeSingle();
    if (eventoError || !evento) return json({ error: 'Evento no encontrado.' }, 404);

    // Comprueba que los asientos seleccionados sigan disponibles.
    const seatIds = items.map((x: any) => x.asiento_id).filter(Boolean);
    if (seatIds.length) {
      const { data: seats, error: seatsError } = await sb.from('asientos').select('id,ocupado').in('id', seatIds);
      if (seatsError) throw seatsError;
      const blocked = (seats ?? []).filter((s: any) => s.ocupado);
      if (blocked.length) return json({ error: 'Uno o más asientos ya fueron ocupados. Actualiza la selección e inténtalo nuevamente.' }, 409);
      if ((seats ?? []).length !== seatIds.length) return json({ error: 'Uno o más asientos no existen.' }, 409);
    }

    const orderId = cleanOrderId(`GLM-${evento_id}-${Date.now()}-${crypto.randomUUID().slice(0,8)}`);
    const secret = Deno.env.get('BOLD_SECRET_KEY');
    const apiKey = Deno.env.get('BOLD_API_KEY');
    if (!secret || !apiKey) return json({ error: 'No están configuradas las llaves de Bold en Supabase.' }, 500);

    // Bold: SHA256(orderId + amount + currency + secret).
    const integritySignature = await sha256Hex(`${orderId}${amount}COP${secret}`);
    const redirectionUrl = Deno.env.get('BOLD_REDIRECTION_URL') || 'https://eduth4846-boop.github.io/qr-pago-bold/';

    const purchase = {
      evento_id,
      sala: sala ?? null,
      nombre,
      cedula,
      correo: String(correo).trim().toLowerCase(),
      telefono: telefono ?? null,
      items,
      total: amount,
      comprobante_url: null,
      estado: 'pendiente',
      tipo_pago: 'bold',
      bold_order_id: orderId,
      bold_status: 'CREATED'
    };

    const { data: created, error: insertError } = await sb.from('solicitudes_compra').insert(purchase).select('id').single();
    if (insertError) throw insertError;

    return json({
      order_id: orderId,
      amount,
      currency: 'COP',
      api_key: apiKey,
      integrity_signature: integritySignature,
      redirection_url: redirectionUrl,
      solicitud_id: created.id,
      description: `Tickets ${evento.nombre}`
    });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error interno.' }, 500);
  }
});
