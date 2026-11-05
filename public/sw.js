/* InventarioPro: guarda la app en el teléfono para poder abrirla sin señal.
   No guarda datos del servidor (eso lo maneja la propia app). */
const CACHE = 'ip-shell-v2'

self.addEventListener('install', () => { self.skipWaiting() })

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

async function trimAssets(cache) {
  const keys = (await cache.keys()).filter(r => new URL(r.url).pathname.startsWith('/assets/'))
  for (const r of keys.slice(0, Math.max(0, keys.length - 40))) await cache.delete(r)
}

self.addEventListener('fetch', event => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return        // Supabase, mapas, etc.: no se tocan
  if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return

  // Páginas: primero internet; sin señal, la última copia de la app
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      try {
        const res = await fetch(req)
        if (res.ok) cache.put('/index.html', res.clone())
        return res
      } catch {
        return (await cache.match('/index.html')) || Response.error()
      }
    })())
    return
  }

  // Archivos de la app (nombre con código único): primero la copia guardada
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const hit = await cache.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) { cache.put(req, res.clone()); trimAssets(cache) }
      return res
    })())
    return
  }

  // Resto (logo, íconos): copia guardada y se actualiza en segundo plano
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req)
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res }).catch(() => hit)
    return hit || net
  })())
})

/* Aviso diario (notificación push) */
self.addEventListener('push', event => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = {} }
  event.waitUntil(self.registration.showNotification(d.title || 'InventarioPro', {
    body: d.body || '',
    icon: '/logo_inventarioPro.png',
    badge: '/logo_inventarioPro.png',
    tag: 'resumen-diario',
    data: { url: '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) { if ('focus' in c) { await c.focus(); return } }
    await self.clients.openWindow('/')
  })())
})
