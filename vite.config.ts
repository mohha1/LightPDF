import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/** Files in public/ that the service worker should also cache. */
const PUBLIC_FILES = ['favicon.svg', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

/**
 * Emits sw.js, a service worker that caches every built file so the app keeps
 * working offline after the first visit.
 */
function serviceWorker(): Plugin {
  return {
    name: 'lightpdf-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [...Object.keys(bundle).filter((file) => !file.endsWith('.map')), ...PUBLIC_FILES];
      const version = createHash('sha256').update(files.sort().join('\n')).digest('hex').slice(0, 12);
      const assets = ['./', ...files.map((file) => `./${file}`)];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorkerSource(version, assets) });
    },
  };
}

function serviceWorkerSource(version: string, assets: string[]): string {
  return `const CACHE = 'lightpdf-${version}';
const ASSETS = ${JSON.stringify(assets)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('lightpdf-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Network first for the page itself, so updates arrive when online.
    event.respondWith(fetch(request).catch(() => caches.match('./', { ignoreSearch: true, ignoreVary: true })));
    return;
  }
  // Built files never change under the same name, so headers such as Vary: Origin don't matter.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached || fetch(request)));
});
`;
}

export default defineConfig({
  // Relative asset paths so the built site works from any folder or subpath.
  base: './',
  build: {
    target: 'es2022',
  },
  plugins: [serviceWorker()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
