import { corsHeaders, json, supabaseAdmin } from '../_shared.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET') return json({ error: 'Método no permitido' }, 405);

  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get('order_id');
    if (!orderId) return json({ error: 'order_id requerido' }, 400);

    const sb = supabaseAdmin();
    const { data: sol, error: solError } = await sb.from('solicitudes_compra').select('id,estado,bold_status,total').eq('bold_order_id', orderId).maybeSingle();
    if (solError) throw solError;
    if (!sol) return json({ error: 'Orden no encontrada' }, 404);

    // Si el webhook ya actualizó el estado, no hace falta consultar Bold otra vez.
    if (sol.estado === 'aprobada') return json({ estado: 'aprobada', bold_status: sol.bold_status });
    if (sol.estado === 'rechazada') return json({ estado: 'rechazada', bold_status: sol.bold_status });

    const apiKey = Deno.env.get('BOLD_API_KEY');
    if (!apiKey) return json({ error: 'BOLD_API_KEY no configurada' }, 500);

    const boldUrl = `https://payments.api.bold.co/v2/payment-voucher/${encodeURIComponent(orderId)}`;
    const res = await fetch(boldUrl, {
      headers: { 'Authorization': `x-api-key ${apiKey}`, 'Accept': 'application/json' }
    });
    const data = await res.json().catch(() => ({}));

    const paymentStatus = String(data?.payment_status || data?.status || '').toUpperCase();
    const mapped = paymentStatus === 'APPROVED' ? 'aprobada' : ['REJECTED','DECLINED','FAILED'].includes(paymentStatus) ? 'rechazada' : 'pendiente_pago';

    if (mapped !== 'pendiente_pago') {
      await sb.from('solicitudes_compra').update({ estado: mapped, bold_status: paymentStatus || 'UNKNOWN' }).eq('id', sol.id);
    } else if (paymentStatus) {
      await sb.from('solicitudes_compra').update({ bold_status: paymentStatus }).eq('id', sol.id);
    }

    return json({ estado: mapped, bold_status: paymentStatus || 'UNKNOWN', raw: data });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : 'Error interno.' }, 500);
  }
});
