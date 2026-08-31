import { corsHeaders, json, genCode, supabaseAdmin } from '../_shared.ts';

function base64EncodeUtf8(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i=0; i<bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  return btoa(binary);
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i=0; i<a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);

  try {
    const raw = await req.text();
    const received = req.headers.get('x-bold-signature') || req.headers.get('x-bold-Signature') || '';
    const secret = Deno.env.get('BOLD_SECRET_KEY') || '';
    const calculated = await hmacHex(secret, base64EncodeUtf8(raw));
    if (!received || !safeEqual(calculated.toLowerCase(), received.toLowerCase())) {
      return json({ error: 'Firma de webhook inválida' }, 400);
    }

    const event = JSON.parse(raw);
    const type = String(event?.type || '').toUpperCase();
    const orderId = event?.data?.metadata?.reference || event?.data?.metadata?.bold_order_id || event?.subject || null;
    if (!orderId) return json({ ok: true, ignored: true });

    const sb = supabaseAdmin();
    const { data: sol, error: findError } = await sb.from('solicitudes_compra').select('*').eq('bold_order_id', orderId).maybeSingle();
    if (findError) throw findError;
    if (!sol) return json({ ok: true, ignored: true });

    const paymentId = event?.data?.payment_id || event?.subject || null;
    const status = event?.data ? type : 'UNKNOWN';

    // Respuesta rápida y procesamiento idempotente: no se crean tickets dos veces.
    if (type === 'SALE_REJECTED') {
      await sb.from('solicitudes_compra').update({ estado:'rechazada', bold_status:status, bold_payment_id:paymentId }).eq('id', sol.id);
      return json({ ok: true });
    }

    if (type !== 'SALE_APPROVED') return json({ ok: true, ignored: true });
    if (sol.estado === 'aprobada') return json({ ok: true, duplicate: true });

    const eventAmount = Number(event?.data?.amount?.total ?? 0);
    if (!Number.isFinite(eventAmount) || eventAmount !== Number(sol.total)) {
      await sb.from('solicitudes_compra').update({ estado:'rechazada', bold_status:'AMOUNT_MISMATCH', bold_payment_id:paymentId }).eq('id', sol.id);
      return json({ error: 'Monto no coincide' }, 400);
    }

    // Reserva/actualiza asientos justo al aprobar, y crea las entradas.
    const rows = (sol.items || []).map((it: any) => ({
      evento_id: sol.evento_id,
      codigo: genCode('TK'),
      codigo_validacion: genCode('VAL'),
      categoria: it.categoria || it.zona,
      ubicacion_tipo: it.zona,
      ubicacion_detalle: it.ubicacion_detalle,
      precio: it.precio,
      nombre_cliente: sol.nombre,
      correo: sol.correo,
      cedula: sol.cedula,
      tipo_pago: 'bold',
      vt_usuario: 'Compra online',
      estado: 'vendido'
    }));

    if (!rows.length) return json({ error: 'La orden no contiene tickets.' }, 400);
    const { data: created, error: ticketError } = await sb.from('tickets').insert(rows).select('*');
    if (ticketError) throw ticketError;

    await Promise.all((sol.items || []).map((it: any, i: number) =>
      it.asiento_id && created?.[i]?.id
        ? sb.from('asientos').update({ ticket_id: created[i].id, ocupado: true }).eq('id', it.asiento_id)
        : Promise.resolve({ error: null })
    ));

    await sb.from('solicitudes_compra').update({ estado:'aprobada', bold_status:'SALE_APPROVED', bold_payment_id:paymentId }).eq('id', sol.id);

    return json({ ok: true, tickets: created?.map((t:any)=>t.id) || [] });
  } catch (error) {
    console.error(error);
    // Bold requiere respuesta rápida; para errores inesperados devolvemos 500 para permitir reintento.
    return json({ error: error instanceof Error ? error.message : 'Error interno.' }, 500);
  }
});
