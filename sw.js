// Bump Appetit service worker.
//
// What this buys her: after the first visit the app opens instantly and works
// completely in flight mode, in a basement restaurant, in a hospital lift. The
// scanner is the only thing that needs a network, and it says so kindly.

// Bump this on every single deploy. It is the one-line change that ships new
// code and new guidance: a new VERSION means a new cache, a fresh precache, and
// the "Fresher guidance is ready" toast on her next open.
const VERSION = 'bump-v1';

const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;
const KEEP = [SHELL_CACHE, DATA_CACHE];

// Derived from the registration rather than assumed to be '/', because GitHub
// Pages serves this from a project subpath like /bump-appetit/.
const SCOPE = (self.registration && self.registration.scope) || self.location.href;
const ROOT = new URL('./', SCOPE);

const at = (path) => new URL(path, ROOT).href;

// The app shell. Cache-first, replaced wholesale when VERSION changes, so the
// HTML, the CSS and every module always come from the same build.
const SHELL = [
  '',                      // the scope root, which is what a cold launch asks for
  'index.html',
  'manifest.webmanifest',

  'assets/styles.css',

  'assets/js/app.js',
  'assets/js/config.js',
  'assets/js/data.js',
  'assets/js/icons.js',
  'assets/js/router.js',
  'assets/js/scanner.js',
  'assets/js/search.js',
  'assets/js/sheet.js',
  'assets/js/sticker.js',
  'assets/js/strings.js',
  'assets/js/trackers.js',
  'assets/js/util.js',
  'assets/js/verdict.js',
  'assets/js/views/bites.js',
  'assets/js/views/more.js',
  'assets/js/views/scan.js',
  'assets/js/views/search.js',

  'assets/vendor/fuse.basic.min.mjs',

  'assets/fonts/bricolage-grotesque-latin.woff2',
  'assets/fonts/nunito-sans-latin.woff2',

  'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png',
  'assets/icons/icon-512.png',
  'assets/icons/maskable-512.png',
].map(at);

// Stale-while-revalidate, so a corrected verdict reaches her on the next open
// without her ever waiting on a network for an answer she already has.
const DATA = [
  'data/caffeine.json',
  'data/cheatsheets.json',
  'data/foods.json',
  'data/lexicon.json',
  'data/meals.json',
  'data/sources.json',
].map(at);

const SHELL_SET = new Set(SHELL);
const DATA_SET = new Set(DATA);
const INDEX = at('index.html');

/** Query strings never change which file this is, and start_url carries one. */
function keyFor(request) {
  const url = new URL(request.url);
  return url.origin + url.pathname;
}

/**
 * Each file is fetched on its own, because cache.addAll rejects the whole
 * install if any single entry 404s, and half an app shell offline is still an
 * app. A file that misses here is simply fetched from the network later.
 */
async function fill(cache, urls) {
  await Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(freshRequest(url));
      if (response && response.ok) await cache.put(url, response);
    } catch {
      // Offline mid-install, or a file that is not in this build.
    }
  }));
}

/** Straight past the HTTP cache, so a new VERSION really does get new files. */
function freshRequest(url) {
  try {
    return new Request(url, { cache: 'reload' });
  } catch {
    // Older Safari rejects the cache option. A normal request still precaches.
    return new Request(url);
  }
}

/**
 * Tells any open page that a newer build is sitting in the wings. The page
 * shows the toast; nothing here ever reloads her out of a search.
 */
async function announceUpdate() {
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const page of pages) page.postMessage({ type: 'BA_UPDATE_READY', version: VERSION });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const [shell, data] = await Promise.all([caches.open(SHELL_CACHE), caches.open(DATA_CACHE)]);
    await Promise.all([fill(shell, SHELL), fill(data, DATA)]);

    // An active worker already exists, so this install is an update rather than
    // a first visit, and there is genuinely something fresher to offer.
    if (self.registration && self.registration.active) await announceUpdate();
  })());
  // Deliberately no skipWaiting here. She decides when to update.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => !KEEP.includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  const type = typeof data === 'string' ? data : (data && data.type);
  if (type === 'SKIP_WAITING') self.skipWaiting();
});

/**
 * A cold offline launch lands here. The cached shell answers straight away, so
 * first paint does not wait on a network that may not be there. Newer HTML only
 * arrives with a new VERSION, which keeps the markup, the CSS and the modules
 * from ever being from different builds.
 */
async function handleNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = (await cache.match(INDEX)) || (await cache.match(ROOT.href));
  if (cached) return cached;

  try {
    return await fetch(request);
  } catch {
    const fallback = await caches.match(INDEX, { ignoreSearch: true });
    if (fallback) return fallback;
    throw new Error('Offline, and the app shell has not been cached yet.');
  }
}

async function cacheFirst(request) {
  const key = keyFor(request);
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(key);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok && response.type === 'basic') {
    await cache.put(key, response.clone());
  }
  return response;
}

/** Serve what we have this instant, then quietly catch up in the background. */
async function staleWhileRevalidate(event) {
  const key = keyFor(event.request);
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(key);

  const fresh = fetch(event.request).then(async (response) => {
    if (response && response.ok && response.type === 'basic') {
      await cache.put(key, response.clone());
    }
    return response;
  }).catch(() => null);

  if (cached) {
    event.waitUntil(fresh);
    return cached;
  }

  const response = await fresh;
  if (response) return response;
  throw new Error('Offline, and this data file has not been cached yet.');
}

async function networkThenCache(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(keyFor(request), { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin is never touched and never cached: the scan Worker endpoint,
  // the OCR bundle and every source link go straight out to the network.
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  const key = url.origin + url.pathname;

  if (DATA_SET.has(key)) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  if (SHELL_SET.has(key)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(networkThenCache(request));
});
