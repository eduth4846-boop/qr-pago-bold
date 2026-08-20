# Cómo activar el pago con Bold

⚠️ **Importante sobre tus llaves**: me compartiste capturas con tus llaves reales de
prueba y de producción. La llave secreta **nunca** debe ir en `index.html` ni en
ningún archivo que viaje al navegador del comprador — cualquiera podría verla con
"Inspeccionar" y generar transacciones falsas. Por eso todo el cálculo con la llave
secreta ocurre en las Edge Functions (servidor), no en el HTML. Como esas llaves ya
quedaron en esta conversación, te recomiendo cargarlas como secreto en Supabase (paso 2)
y, si te da tranquilidad, regenerarlas luego desde bold.co para tener unas que nadie
más haya visto.

## 1. Crea el esquema completo de base de datos
En Supabase → **SQL Editor**, pega y ejecuta el contenido completo de
`supabase/migrations/000_schema_completo.sql`. Este archivo crea **todas** las
tablas de la app (eventos, asientos, tickets, solicitudes_compra, mensajes,
vendedores, comprobantes), el bucket de Storage `comprobantes`, los índices,
realtime y las políticas de RLS — de una sola vez, sobre una base de datos vacía.

## 2. Configura los "secrets" de las Edge Functions
Necesitas el Supabase CLI instalado y logueado (`npx supabase login`), con el proyecto
enlazado (`npx supabase link --project-ref ukmmrbjmeumjkxdblmgc`).

```bash
npx supabase secrets set \
  BOLD_IDENTITY_KEY="tu_llave_de_identidad" \
  BOLD_SECRET_KEY="tu_llave_secreta" \
  BOLD_WEBHOOK_KEY="tu_llave_de_identidad" \
  SITE_URL="https://tu-dominio-o-pagina.com/index.html" \
  SUPABASE_SERVICE_ROLE_KEY="tu_service_role_key" \
  SUPABASE_URL="https://ukmmrbjmeumjkxdblmgc.supabase.co"
```

- `SUPABASE_SERVICE_ROLE_KEY` la encuentras en Supabase → Settings → API → `service_role`.
  Es otra llave secreta: solo vive en este "secrets set", jamás en el frontend.
- Empieza con las **llaves de pruebas** de Bold. Cuando confirmes que todo funciona,
  reemplaza `BOLD_IDENTITY_KEY` y `BOLD_SECRET_KEY` por las de producción.
- `BOLD_WEBHOOK_KEY`: Bold documenta que la firma del webhook se valida con la Llave
  de identidad, pero su propio ejemplo de código usa una variable llamada
  `secret_key`. Es una inconsistencia real de su documentación. Deja primero la llave
  de identidad; en el paso 4 usa "Probar el webhook" para confirmar si valida. Si no
  valida, cambia este secret por la llave secreta y vuelve a probar.

## 3. Despliega las tres funciones
```bash
npx supabase functions deploy bold-crear-orden --no-verify-jwt
npx supabase functions deploy bold-webhook --no-verify-jwt
npx supabase functions deploy bold-verificar-pago --no-verify-jwt
```
`--no-verify-jwt` es necesario porque Bold y tus compradores anónimos las llaman sin
sesión de Supabase.

## 4. Configura el webhook en el panel de Bold
En bold.co → Integraciones → Webhooks → Configurar webhook, agrega:
```
https://ukmmrbjmeumjkxdblmgc.supabase.co/functions/v1/bold-webhook
```
Usa la opción **"Probar el webhook"** después de una compra de prueba para confirmar
que tu endpoint responde 200 y que la firma valida (ver nota del paso 2).

## 5. Sube el nuevo index.html
Reemplaza tu `index.html` actual por el de esta carpeta (ya incluye el botón "Pagar
con Bold").

## 6. Prueba de punta a punta (con llaves de pruebas)
1. Entra como comprador, elige una ubicación y pulsa **Pagar con Bold**.
2. Completa el pago en el modo de pruebas.
3. Al volver a tu sitio deberías ver "¡Pago confirmado!" y el ticket debe aparecer en
   "Mis tickets" con tu correo/cédula, sin que el administrador tenga que aprobarlo.
4. Prueba también un pago rechazado para confirmar que el asiento se libera.

Solo cuando esto funcione en pruebas, cambia las llaves por las de producción (paso 2)
y repite la prueba con un cobro real pequeño antes de anunciar el botón a tus
compradores.

## Qué quedó igual
- El método de "transferencia + comprobante" sigue disponible (colapsado bajo "Otro
  método de pago") y el administrador lo sigue aprobando manualmente como antes.
- Si por cualquier motivo el webhook de Bold no llegara, `bold-verificar-pago` actúa
  como respaldo automático apenas el comprador vuelve a tu página, y siempre puedes
  revisar el estado de la venta en el panel de Bold.
