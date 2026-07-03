/**
 * App-shell service worker: network-first with cache fallback, so the whole
 * product is airplane-mode capable after one online visit. Model bytes live
 * in OPFS (managed by the neural client), never here; API and model
 * downloads are passed through untouched.
 */
const CACHE = 'motif-forge-shell-v1'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/models/')) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      try {
        const fresh = await fetch(event.request)
        if (fresh.ok) cache.put(event.request, fresh.clone())
        return fresh
      } catch (err) {
        const hit = await cache.match(event.request)
        if (hit) return hit
        if (event.request.mode === 'navigate') {
          const shell = await cache.match('/')
          if (shell) return shell
        }
        throw err
      }
    })(),
  )
})
