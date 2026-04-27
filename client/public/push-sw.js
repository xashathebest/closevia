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
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
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
