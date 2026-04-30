self.CACHE_NAME = 'clovia-v2-logo-update'

self.addEventListener('activate', (event) => {
  const oldRuntimeCaches = new Set([
    'pages-cache',
    'firebase-auth-cache',
    'firebase-api-cache',
    'google-fonts-cache',
    'cloudinary-cache',
    'cdn-cache',
    'assets-cache',
    'images-cache',
  ])

  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => !cacheName.includes(self.CACHE_NAME))
        .filter((cacheName) => cacheName.includes('clovia') || oldRuntimeCaches.has(cacheName))
        .map((cacheName) => caches.delete(cacheName))
    ))
  )
})

self.addEventListener('push', (event) => {
  let data = {
    title: 'CloviaPH',
    body: 'You have a new CloviaPH update.',
    url: '/notifications',
  }

  try {
    if (event.data) {
      data = { ...data, ...event.data.json() }
    }
  } catch {
    try {
      data.body = event.data ? event.data.text() : data.body
    } catch {}
  }

  const targetUrl = data.url || '/notifications'
  event.waitUntil(
    self.registration.showNotification(data.title || 'CloviaPH', {
      body: data.body || '',
      icon: '/icons/CloviaLogo.svg?v=2',
      badge: '/icons/CloviaLogo.svg?v=2',
      data: { url: targetUrl },
      tag: data.tag || targetUrl,
      renotify: false,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const rawUrl = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/notifications'
  const targetUrl = new URL(rawUrl, self.location.origin).href

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windowClients) {
      if ('navigate' in client && 'focus' in client) {
        await client.navigate(targetUrl)
        return client.focus()
      }
    }
    return clients.openWindow(targetUrl)
  })())
})
