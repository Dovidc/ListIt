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

async function parsePushData(data) {
  if (!data) return {};
  try {
    return await data.json();
  } catch (err) {
    let text = '';
    try {
      text = await data.text();
    } catch {
      return {};
    }

    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { body: text };
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
    const conversationId = payload.conversation_id || payload.conversationId;
    options.data.url = conversationId ? `/#messages/${conversationId}` : '/#messages';
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
  const promise = (async () => {
    const payload = await parsePushData(event.data);
    const { title, options } = buildNotification(payload);
    return self.registration.showNotification(title, options);
  })();

  if (event.waitUntil) {
    event.waitUntil(promise);
  } else {
    promise.catch(() => {});
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.url || '/';
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

    // If app is already open, post a message to navigate
    for (const client of windowClients) {
      try {
        if ('focus' in client) await client.focus();
      } catch {}

      // Post message to the client to handle navigation
      const conversationId = data.conversation_id || data.conversationId;
      if (conversationId) {
        client.postMessage({
          type: 'NOTIFICATION_CLICK',
          conversation_id: conversationId
        });
        return;
      }

      // Fallback to URL navigation if no conversation_id
      if ('navigate' in client && client.url !== destination) {
        try {
          await client.navigate(destination);
        } catch {}
      }
      return;
    }

    // No existing window, open a new one
    if (self.clients.openWindow) {
      await self.clients.openWindow(destination);
    }
  })());
});
