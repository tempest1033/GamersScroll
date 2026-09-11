(function serviceWorkerRuntime(config, eligible) {
  const STATIC_CACHE = config.version + '-static';
  const RUNTIME_CACHE = config.version + '-runtime';
  const PREFETCH_CACHE = config.version + '-prefetch';
  const PREFETCH_TTL = 20000;
  const STATIC_EXT_RE = /\.(?:css|js|mjs|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf|json)$/i;
  const pending = new Map();
  function cacheable(response) {
    return response && response.status === 200 && !/no-store|private/i.test(response.headers.get('cache-control') || '');
  }
  async function cachePut(cacheName, request, response) {
    if (!cacheable(response)) return response;
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    return response;
  }
  async function networkFirst(request, cacheName, event) {
    try {
      const response = await fetch(request);
      // Cache a clone in the background; do not hold streamed HTML behind cache.put.
      event.waitUntil(cachePut(cacheName, request, response).catch(() => undefined));
      return response;
    } catch (error) {
      // Query strings may select different rankings/search results; never ignore them.
      const cached = await caches.match(request);
      if (cached) return cached;
      return new Response('Offline. Please reconnect and reload this page.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
  async function prefetch(raw) {
    const url = eligible(raw, self.location.origin);
    if (!url || pending.has(url) || pending.size >= 2) return;
    const work = (async () => {
      const cache = await caches.open(PREFETCH_CACHE);
      const previous = await cache.match(url);
      if (previous && Date.now() - Number(previous.headers.get('x-gs-prefetched-at')) < PREFETCH_TTL) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetch(new Request(url, { headers: { Accept: 'text/html' }, signal: controller.signal }));
        if (!cacheable(response) || response.redirected || !/text\/html/i.test(response.headers.get('content-type') || '')) return;
        const headers = new Headers(response.headers);
        headers.set('x-gs-prefetched-at', String(Date.now()));
        await cache.put(url, new Response(response.body, { status: response.status, headers }));
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 4)).map(key => cache.delete(key)));
      } finally { clearTimeout(timeout); }
    })();
    pending.set(url, work);
    try { await work; } catch { /* Speculative work is optional; navigation still performs a normal request. */ }
    finally { pending.delete(url); }
  }
  async function navigate(request, event) {
    if (eligible(request.url, self.location.origin)) {
      try {
        const cache = await caches.open(PREFETCH_CACHE);
        const response = await cache.match(request);
        if (response) {
          await cache.delete(request);
          const timestamp = Number(response.headers.get('x-gs-prefetched-at'));
          if (timestamp > 0 && Date.now() - timestamp < PREFETCH_TTL) {
            const headers = new Headers(response.headers);
            headers.delete('x-gs-prefetched-at');
            return new Response(response.body, { status: response.status, headers });
          }
        }
      } catch { /* A missing/unavailable cache does not block navigation. */ }
    }
    return networkFirst(request, RUNTIME_CACHE, event);
  }
  self.addEventListener('message', event => {
    if (event.data && event.data.type === 'gs-prefetch' &&
        event.source && new URL(event.source.url).origin === self.location.origin) {
      event.waitUntil(prefetch(event.data.url));
    }
  });
  self.addEventListener('install', event => {
    event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(config.precache)).catch(() => undefined));
    self.skipWaiting();
  });
  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(
      names.filter(name => name.startsWith('gamerscroll-') && ![STATIC_CACHE, RUNTIME_CACHE, PREFETCH_CACHE].includes(name))
        .map(name => caches.delete(name))
    )).then(() => self.clients.claim()));
  });
  self.addEventListener('fetch', event => {
    const request = event.request;
    if (!request || request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (request.mode === 'navigate' || (request.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(navigate(request, event));
      return;
    }
    const isStatic = url.pathname.startsWith('/assets/') || url.pathname.startsWith('/rankings/') || STATIC_EXT_RE.test(url.pathname);
    if (isStatic) {
      const immutable = /^[a-f0-9]{8,}$/i.test(url.searchParams.get('v') || '') || /\.[a-f0-9]{8,}\./i.test(url.pathname) ||
        /\/assets\/fonts\/pretendard-[\d.]+\//.test(url.pathname) ||
        /\/assets\/apexcharts-[\d.]+\.min\.js$/.test(url.pathname) ||
        /\/assets\/feed\/[^/]+-[a-f0-9]{12}\.json$/.test(url.pathname);
      if (immutable) {
        event.respondWith((async () => {
          const cached = await caches.match(request);
          return cached || networkFirst(request, STATIC_CACHE, event);
        })());
        return;
      }
      event.respondWith(networkFirst(request, STATIC_CACHE, event));
      return;
    }
    event.respondWith(networkFirst(request, RUNTIME_CACHE, event));
  });
})({"version":"gamerscroll-804d625e-4fefdce9","precache":["/","/styles-core.e144d411.css","/styles-catalog.e144d411.css","/styles-report.e144d411.css","/styles-game.e144d411.css","/styles-article.e144d411.css","/manifest.json","/icon-192.png","/icon-512.png","/assets/layout-core.js?v=804d625e","/assets/layout-runtime.js?v=804d625e"]}, function prefetchUrl(raw, origin) {
  try {
    const url = new URL(raw, origin);
    if (url.origin !== origin || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/(?:$|(?:games|rankings|steam|reports|magazine|about|privacy)\/)/.test(url.pathname)) return null;
    if (!url.pathname.endsWith('/')) return null;
    return url.href;
  } catch {
    return null;
  }
});