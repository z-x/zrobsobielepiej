<script>
  import { onMount } from 'svelte';
  import { videos } from '$lib/videos.js';

  const STORAGE_KEY = 'pwa-reminder-state';
  const videoUrls = videos.map((v) => v.url);

  // Reactive state
  let interval = $state(15);
  let isActive = $state(false);
  let permission = $state('default');
  let swSupported = $state(true);
  let currentVideoUrl = $state(null);
  let showThanks = $state(false);
  let activeInterval = $state(15);

  onMount(() => {
    swSupported = 'serviceWorker' in navigator;

    if ('Notification' in window) {
      permission = Notification.permission;
    }

    // Restore persisted state
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const saved = JSON.parse(raw);
        interval = saved.interval ?? 15;
        activeInterval = interval;
        // Re-activate only if permission still granted
        if (saved.isActive && Notification.permission === 'granted') {
          isActive = true;
        }
      } catch {
        // Ignore corrupt storage
      }
    }

    if (!swSupported) return;

    // Listen for PLAY_VIDEO from service worker (notification clicked while app was open)
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'PLAY_VIDEO') {
        activeInterval = event.data.interval ?? interval;
        openVideo(event.data.videoUrl);
      }
    });

    // Handle ?play= URL param (notification clicked while app was closed)
    const params = new URLSearchParams(location.search);
    if (params.has('play')) {
      activeInterval = parseInt(params.get('interval') ?? String(interval));
      openVideo(decodeURIComponent(params.get('play')));
      history.replaceState(null, '', location.pathname);
    }

    // Once SW is ready, re-register the active schedule
    navigator.serviceWorker.ready.then((reg) => {
      if (isActive) {
        reg.active?.postMessage({ type: 'START_NOTIFICATIONS', interval, videos: videoUrls });
      }
    });

    // Refresh permission status when user returns to tab (they may have changed it in settings)
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && 'Notification' in window) {
        permission = Notification.permission;
        if (permission === 'denied' && isActive) {
          isActive = false;
          persist();
          sendToSW('STOP_NOTIFICATIONS');
        }
      }
    });
  });

  async function toggleActive() {
    if (isActive) {
      isActive = false;
      persist();
      sendToSW('STOP_NOTIFICATIONS');
      return;
    }

    if (!('Notification' in window)) return;

    if (permission === 'default') {
      const result = await Notification.requestPermission();
      permission = result;
    }

    if (permission !== 'granted') return;

    isActive = true;
    activeInterval = interval;
    persist();
    sendToSW('START_NOTIFICATIONS', { interval, videos: videoUrls });
  }

  function changeInterval(mins) {
    interval = mins;
    persist();
    if (isActive) {
      activeInterval = mins;
      sendToSW('START_NOTIFICATIONS', { interval: mins, videos: videoUrls });
    }
  }

  function sendToSW(type, data = {}) {
    const payload = { type, ...data };
    const controller = navigator.serviceWorker?.controller;
    if (controller) {
      controller.postMessage(payload);
    } else {
      navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage(payload));
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ interval, isActive }));
  }

  function openVideo(url) {
    showThanks = false;
    currentVideoUrl = url;
  }

  function onVideoEnded() {
    currentVideoUrl = null;
    showThanks = true;
  }

  function closeOverlay() {
    currentVideoUrl = null;
    showThanks = false;
  }

  const permissionInfo = $derived(
    permission === 'granted'
      ? { label: 'Notifications allowed', color: 'var(--success)' }
      : permission === 'denied'
        ? { label: 'Notifications blocked — enable in browser settings', color: 'var(--danger)' }
        : { label: 'Notification permission not yet granted', color: 'var(--text-muted)' }
  );
</script>

<svelte:head>
  <title>Video Reminder</title>
</svelte:head>

<main>
  <header>
    <div class="logo" aria-hidden="true">
      <svg viewBox="0 0 100 100" width="56" height="56" xmlns="http://www.w3.org/2000/svg">
        <rect width="100" height="100" rx="22" fill="#6366f1"/>
        <circle cx="50" cy="50" r="28" fill="rgba(255,255,255,0.12)"/>
        <polygon points="43,36 67,50 43,64" fill="white"/>
      </svg>
    </div>
    <h1>Video Reminder</h1>
    <p class="tagline">Scheduled video breaks to keep you on track</p>
  </header>

  {#if !swSupported}
    <div class="banner banner-warn">
      Service workers aren't supported in this browser — notifications won't work offline.
    </div>
  {/if}

  <div class="card">
    <div class="permission-row" style="color: {permissionInfo.color}">
      <span class="dot" style="background: {permissionInfo.color}"></span>
      {permissionInfo.label}
    </div>

    <section>
      <h2 class="section-label">Reminder interval</h2>
      <div class="interval-grid">
        {#each [10, 15, 20] as mins}
          <button
            class="interval-btn"
            class:selected={interval === mins}
            onclick={() => changeInterval(mins)}
            aria-pressed={interval === mins}
          >
            {mins} min
          </button>
        {/each}
      </div>
    </section>

    <button
      class="main-btn"
      class:stop={isActive}
      onclick={toggleActive}
      disabled={permission === 'denied'}
    >
      {#if isActive}
        Stop Reminders
      {:else}
        Start Reminders
      {/if}
    </button>

    <div class="status-row" class:active-status={isActive}>
      {#if isActive}
        <span class="pulse-dot" aria-hidden="true"></span>
        Active — notifying every {activeInterval} minutes
      {:else}
        <span class="idle-dot" aria-hidden="true"></span>
        Reminders are off
      {/if}
    </div>
  </div>

  <p class="hint">
    Install as a PWA for reliable background notifications. Videos are chosen randomly from a predefined set.
  </p>
</main>

<!-- ── Video overlay ── -->
{#if currentVideoUrl}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Video player">
    <button class="close-btn" onclick={closeOverlay} aria-label="Close video">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video
      src={currentVideoUrl}
      autoplay
      playsinline
      controls
      onended={onVideoEnded}
    ></video>
  </div>
{/if}

<!-- ── Thanks overlay ── -->
{#if showThanks}
  <div class="overlay thanks-overlay" role="dialog" aria-modal="true" aria-label="See you soon">
    <div class="thanks-card">
      <div class="thanks-emoji" aria-hidden="true">🌟</div>
      <h2>Thanks for watching!</h2>
      <p>See you in <strong>{activeInterval} {activeInterval === 1 ? 'minute' : 'minutes'}</strong>.</p>
      <button class="got-it-btn" onclick={closeOverlay}>Got it</button>
    </div>
  </div>
{/if}

<style>
  main {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2.5rem 1.25rem;
    gap: 2rem;
  }

  header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .logo {
    filter: drop-shadow(0 0 24px rgba(99, 102, 241, 0.4));
  }

  h1 {
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }

  .tagline {
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .banner {
    width: 100%;
    max-width: 420px;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    text-align: center;
  }

  .banner-warn {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: var(--warning);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.75rem;
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .permission-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    font-weight: 500;
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-secondary);
    margin-bottom: 0.75rem;
  }

  .interval-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .interval-btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    padding: 0.75rem 0.5rem;
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition);
  }

  .interval-btn:hover {
    border-color: var(--accent);
    color: var(--text);
  }

  .interval-btn.selected {
    background: rgba(99, 102, 241, 0.15);
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 600;
  }

  .main-btn {
    width: 100%;
    padding: 1rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--accent);
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
    letter-spacing: -0.01em;
  }

  .main-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.35);
  }

  .main-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  .main-btn.stop {
    background: var(--surface-2);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }

  .main-btn.stop:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.12);
    border-color: var(--danger);
    color: var(--danger);
    box-shadow: none;
  }

  .main-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .status-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--text-muted);
  }

  .status-row.active-status {
    color: var(--success);
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--success);
    animation: pulse 2s ease-in-out infinite;
    flex-shrink: 0;
  }

  .idle-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.7); }
  }

  .hint {
    max-width: 380px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.78rem;
    line-height: 1.6;
  }

  /* ── Overlays ── */

  .overlay {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fade-in 0.25s ease;
  }

  @keyframes fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .close-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 50%;
    color: white;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background var(--transition);
    z-index: 51;
  }

  .close-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  video {
    width: 100%;
    height: 100%;
    max-height: 100dvh;
    object-fit: contain;
  }

  .thanks-overlay {
    background: var(--bg);
  }

  .thanks-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 2.5rem 2rem;
    text-align: center;
    animation: slide-up 0.3s ease;
  }

  @keyframes slide-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .thanks-emoji {
    font-size: 4rem;
    line-height: 1;
  }

  .thanks-card h2 {
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.03em;
  }

  .thanks-card p {
    font-size: 1.2rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .thanks-card strong {
    color: var(--accent);
    font-weight: 600;
  }

  .got-it-btn {
    margin-top: 0.5rem;
    padding: 0.875rem 2.5rem;
    background: var(--accent);
    border: none;
    border-radius: var(--radius-sm);
    color: white;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
  }

  .got-it-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }
</style>
