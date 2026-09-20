/** Build-time shell manifest: no API, credentials, or user data enter this cache. */
export function shellWorker(files: string[]): string {
  const assets = ['/index.html', ...files.filter(file => file.startsWith('assets/')).map(file => `/${file}`)].sort();
  const version = assets.join('|').split('').reduce((hash,char) => ((hash * 31) + char.charCodeAt(0)) >>> 0, 0).toString(36);
  return `const CACHE = ${JSON.stringify(`lister-shell-${version}`)};
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lister-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws' || event.request.headers.has('authorization')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(cached => cached || fetch(event.request)));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});`;
}
