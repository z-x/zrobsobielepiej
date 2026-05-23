/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const CACHE_NAME = `cache-${version}`;
const ASSETS = [...build, ...files];

let notificationTimer = null;
let currentInterval = 0;
let currentVideos = [];

// ---- Install: pre-cache app shell ----
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // Cache individually so one failure doesn't block the install
      await Promise.allSettled(ASSETS.map((url) => cache.add(url).catch(() => {})));
      await self.skipWaiting();
    })()
  );
});

// ---- Activate: clean up old caches ----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE_NAME && key !== 'notification-state') {
          await caches.delete(key);
        }
      }
      await self.clients.claim();
      // Resume any active schedule that survived a SW restart
      await resumeScheduleIfNeeded();
    })()
  );
});

// ---- Fetch: cache-first for assets, network-first otherwise ----
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      const url = new URL(event.request.url);
      const cache = await caches.open(CACHE_NAME);

      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }

      try {
        const response = await fetch(event.request);
        // Only cache same-origin, successful responses (not video streams)
        if (
          response.status === 200 &&
          url.origin === self.location.origin &&
          !url.pathname.includes('/api/')
        ) {
          cache.put(event.request, response.clone());
        }
        return response;
      } catch {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        return new Response('Offline', { status: 503 });
      }
    })()
  );
});

// ---- Messages from the main thread ----
self.addEventListener('message', async (event) => {
  const { type, interval, videos } = event.data ?? {};

  if (type === 'START_NOTIFICATIONS') {
    currentInterval = interval;
    currentVideos = videos ?? [];
    clearTimer();
    await saveState({ active: true, interval, videos, nextAt: Date.now() + interval * 60 * 1000 });
    scheduleNext();
  } else if (type === 'STOP_NOTIFICATIONS') {
    clearTimer();
    currentInterval = 0;
    currentVideos = [];
    await saveState({ active: false });
  }
});

// ---- Notification click: open/focus the app and trigger video ----
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { videoUrl, interval } = event.notification.data ?? {};

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Post message to already-open window
          client.postMessage({ type: 'PLAY_VIDEO', videoUrl, interval });
          return client.focus();
        }
        // No open window — open the app with URL params
        const target = `/?play=${encodeURIComponent(videoUrl)}&interval=${interval}`;
        return self.clients.openWindow(target);
      })
  );
});

// ---- Scheduling helpers ----

function clearTimer() {
  if (notificationTimer !== null) {
    clearTimeout(notificationTimer);
    notificationTimer = null;
  }
}

function scheduleNext() {
  clearTimer();
  if (!currentInterval || !currentVideos.length) return;

  const delay = currentInterval * 60 * 1000;
  const nextAt = Date.now() + delay;
  saveState({ active: true, interval: currentInterval, videos: currentVideos, nextAt });

  notificationTimer = setTimeout(async () => {
    await fireNotification();
    scheduleNext();
  }, delay);
}

async function fireNotification() {
  const videoUrl = currentVideos[Math.floor(Math.random() * currentVideos.length)];

  await self.registration.showNotification('Time for a break! 🎬', {
    body: `Your ${currentInterval}-minute reminder is here. Tap to watch.`,
    icon: '/icon.svg',
    badge: '/icon.svg',
    data: { videoUrl, interval: currentInterval },
    tag: 'video-reminder',
    requireInteraction: false,
    vibrate: [200, 100, 200]
  });
}

// If the SW was killed and restarted, recover any missed/pending notification
async function resumeScheduleIfNeeded() {
  const state = await loadState();
  if (!state?.active || !state.interval || !state.videos?.length) return;

  currentInterval = state.interval;
  currentVideos = state.videos;

  const remaining = (state.nextAt ?? 0) - Date.now();

  if (remaining <= 0) {
    // Missed — fire immediately and reschedule
    await fireNotification();
    scheduleNext();
  } else {
    // Fire when remaining time elapses
    const nextAt = Date.now() + remaining;
    saveState({ ...state, nextAt });
    notificationTimer = setTimeout(async () => {
      await fireNotification();
      scheduleNext();
    }, remaining);
  }
}

// ---- Persistent state via Cache Storage (available in both SW and main thread) ----

async function saveState(state) {
  try {
    const cache = await caches.open('notification-state');
    await cache.put(
      '/notification-state',
      new Response(JSON.stringify(state), {
        headers: { 'Content-Type': 'application/json' }
      })
    );
  } catch {
    // Non-fatal — state will be re-sent on next app open
  }
}

async function loadState() {
  try {
    const cache = await caches.open('notification-state');
    const response = await cache.match('/notification-state');
    if (!response) return null;
    return await response.json();
  } catch {
    return null;
  }
}
