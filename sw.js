/*
 * Service Worker de Cashless Colombia.
 *
 * Su único objetivo es cumplir el requisito que le falta a la app para que
 * Chrome/Android la reconozca como "instalable" de verdad: hoy, "Agregar a
 * pantalla de inicio" solo crea un ACCESO DIRECTO que abre el navegador
 * normal (con barra de direcciones). Con este archivo + manifest.json,
 * Chrome ofrece "Instalar app" y la abre en su propia ventana, como una
 * app nativa.
 *
 * A propósito NO cachea agresivamente el contenido de la app: los
 * tickets, el saldo y los eventos siempre deben venir en vivo de
 * Supabase, nunca de una copia vieja guardada en el teléfono. Por eso:
 *   - Solo intercepta pedidos del MISMO origen (el HTML, este archivo,
 *     el manifest, los íconos). Todo lo demás (Supabase, la librería de
 *     QR, fuentes, etc.) se deja pasar directo a la red, sin tocarlo.
 *   - Siempre intenta la RED PRIMERO. Solo si no hay internet en ese
 *     momento, responde con la última copia guardada, para que la app
 *     al menos abra en vez de mostrar el error de "sin conexión" del
 *     navegador.
 *   - skipWaiting()/clients.claim() + borrar cachés viejas: para que una
 *     actualización de la app se vea de inmediato la próxima vez que se
 *     abre, sin quedar "pegado" en una versión anterior.
 */
const CACHE_NAME = 'cashless-shell-v1';
const APP_SHELL = [
  './index_24.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Deja pasar sin tocar todo lo que no sea un archivo propio de la app
  // (Supabase, html5-qrcode desde unpkg, fuentes, etc.).
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          try { cache.put(req, copy); } catch (e) {}
        });
        return response;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          // Sin internet y sin copia de este archivo puntual: si era la
          // página principal, al menos abre el último HTML guardado.
          if (req.mode === 'navigate') return caches.match('./index_24.html');
          return undefined;
        })
      )
  );
});