'use strict';

self.addEventListener('install', (event) => {
  if (self.skipWaiting) {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('activate', (event) => {
  if (self.clients && self.clients.claim) {
    event.waitUntil(self.clients.claim());
  }
});

function parsePushData(data) {
  if (!data) return {};
  try {
    return data.json();
  } catch (err) {
    try {
      const text = data.text();
      return text ? JSON.parse(text) : {};
    } catch {
      try {
        return { body: data.text() };
      } catch {
        return {};
      }
    }
  }
}

function buildNotification(payload = {}) {
  const type = payload.type || 'generic';
  const options = {
    body: '',
    data: { ...payload },
    tag: `listit-${type}`,
    renotify: type === 'new_message',
    requireInteraction: false
  };

  let title = 'ListIt';

  if (type === 'new_message') {
    title = 'New message on ListIt';
    const sender = payload.sender_name || payload.sender_username || payload.sender || '';
    const preview = payload.body || '';
    if (sender && preview) {
      options.body = `${sender}: ${preview}`;
    } else if (sender) {
      options.body = `${sender} sent you a message.`;
    } else {
      options.body = preview || 'You have a new message.';
    }
    options.data.url = '/#messages';
  } else if (type === 'nearby_listing') {
    title = 'Nearby listing on ListIt';
    const parts = [];
    if (payload.title) parts.push(payload.title);
    if (payload.location) parts.push(payload.location);
    if (payload.price) parts.push(payload.price);
    options.body = parts.length ? parts.join(' • ') : 'A nearby item was posted near you.';
    options.data.url = '/';
  } else {
    title = payload.title || 'ListIt';
    options.body = payload.body || 'You have a new notification.';
    if (payload.url && !options.data.url) options.data.url = payload.url;
  }

  if (payload.icon) options.icon = payload.icon;
  if (payload.badge) options.badge = payload.badge;
  if (payload.image) options.image = payload.image;

  if (!options.body) options.body = 'You have a new notification.';

  return { title, options };
}

self.addEventListener('push', (event) => {
  const payload = parsePushData(event.data);
  const { title, options } = buildNotification(payload);
  if (event.waitUntil) {
    event.waitUntil(self.registration.showNotification(title, options));
  } else {
    self.registration.showNotification(title, options);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';
  const destination = (() => {
    try {
      return new URL(target, self.location.origin).href;
    } catch {
      return self.location.origin || '/';
    }
  })();

  event.waitUntil((async () => {
    if (!self.clients || !self.clients.matchAll) {
      if (self.clients && self.clients.openWindow) {
        await self.clients.openWindow(destination);
      }
      return;
    }

    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windowClients) {
      try {
        if ('focus' in client) await client.focus();
      } catch {}
      if ('navigate' in client && client.url !== destination) {
        try {
          await client.navigate(destination);
        } catch {}
      }
      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(destination);
    }
  })());
});
