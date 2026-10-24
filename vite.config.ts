import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
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

/**
 * Loads `file?classic` as the source of that JavaScript module rewritten as a
 * classic script, for the PDF.js worker in the single-file build. Only the
 * module-only syntax changes; the build fails if the file no longer matches.
 */
function classicWorker(): Plugin {
  return {
    name: 'lightpdf-classic-worker',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('?classic')) return null;
      const resolved = await this.resolve(source.slice(0, -'?classic'.length), importer, { skipSelf: true });
      return resolved && `${resolved.id}?classic`;
    },
    load(id) {
      if (!id.endsWith('?classic')) return null;
      const module = readFileSync(id.slice(0, -'?classic'.length), 'utf8');
      const exports = /export\s*\{\s*WorkerMessageHandler\s*\};?\s*$/;
      if (!exports.test(module)) throw new Error(`${id}: unexpected exports, update classicWorker() in vite.config.ts`);
      const script = module.replace(exports, '').replaceAll('import.meta.url', 'self.location.href');
      // Compiling (not running) it as a classic script fails on any module-only syntax left.
      new Script(script, { filename: id });
      return `export default ${JSON.stringify(script)};`;
    },
  };
}

const MUPDF = fileURLToPath(new URL('node_modules/mupdf/dist/', import.meta.url));

function withoutWasmReference(code: string): string {
  const reference = 'new URL("mupdf-wasm.wasm",import.meta.url).href';
  if (!code.includes(reference)) throw new Error('MuPDF changed shape; update mupdf() in vite.config.ts');
  return code.replace(reference, '"mupdf-wasm.wasm"');
}

/**
 * MuPDF (redaction) for the browser, loaded only when a download has boxes to
 * redact:
 * - `virtual:mupdf-wasm` is the URL of its WebAssembly, gzipped (10 MB becomes
 *   about 4 MB; src/browser/mupdf.ts unzips it). It is a hashed asset, or a
 *   data: URL in the single-file build and the dev server.
 * - `virtual:mupdf-source` (single-file build only) is MuPDF's two modules
 *   joined into one module's source text, which the page imports from a blob:
 *   URL; a page opened from disk can't load other files.
 */
function mupdf(single: boolean): Plugin {
  let serving = false;
  return {
    name: 'lightpdf-mupdf',
    configResolved(config) {
      serving = config.command === 'serve';
    },
    resolveId(source) {
      return source === 'virtual:mupdf-wasm' || source === 'virtual:mupdf-source' ? `\0${source}` : null;
    },
    transform(code, id) {
      // The app hands MuPDF its WebAssembly (wasmBinary), so its own reference
      // to the file goes, or the bundler would ship the 10 MB file as well.
      if (!id.startsWith(`${MUPDF}mupdf-wasm.js`)) return null;
      return withoutWasmReference(code);
    },
    load(id) {
      if (id === '\0virtual:mupdf-wasm') {
        const gzipped = gzipSync(readFileSync(`${MUPDF}mupdf-wasm.wasm`), { level: 9 });
        if (single || serving) return `export default ${JSON.stringify(`data:application/octet-stream;base64,${gzipped.toString('base64')}`)};`;
        // Not ".gz": some servers would send that with Content-Encoding: gzip.
        const ref = this.emitFile({ type: 'asset', name: 'mupdf-wasm.bin', source: gzipped });
        return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
      }
      if (id === '\0virtual:mupdf-source') {
        const loader = readFileSync(`${MUPDF}mupdf-wasm.js`, 'utf8');
        const api = readFileSync(`${MUPDF}mupdf.js`, 'utf8');
        const exported = /export default _;\s*$/;
        const imported = 'import libmupdf_wasm from "./mupdf-wasm.js";';
        if (!exported.test(loader) || !api.includes(imported)) throw new Error('MuPDF changed shape; update mupdf() in vite.config.ts');
        const joined = api.replace(imported, () => `const libmupdf_wasm = (() => { ${withoutWasmReference(loader).replace(exported, '')}; return _; })();`);
        return `export default ${JSON.stringify(joined)};`;
      }
      return null;
    },
  };
}

/**
 * Puts the whole app into one HTML file that works when opened from disk,
 * where browsers refuse to load JavaScript modules from separate files.
 */
function singleFile(): Plugin {
  return {
    name: 'lightpdf-single-file',
    enforce: 'post',
    transformIndexHtml(html) {
      const favicon = readFileSync(fileURLToPath(new URL('public/favicon.svg', import.meta.url)));
      return html
        .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" href="data:image/svg+xml;base64,${favicon.toString('base64')}" type="image/svg+xml" />`)
        .replace(/\s*<link rel="manifest"[^>]*>/, '');
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const page = bundle['index.html'];
        if (page?.type !== 'asset') throw new Error('index.html missing from the bundle');
        let html = String(page.source);
        for (const [fileName, file] of Object.entries(bundle)) {
          const tag = new RegExp(`<(script|link)[^>]*(?:src|href)="\\./${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>(?:</script>)?`);
          if (file.type === 'chunk' && file.isEntry) {
            // "<!--" can change how a browser reads the rest of an inline script.
            if (file.code.includes('<!--')) throw new Error(`${fileName} contains "<!--"; it can't be inlined safely`);
            const code = file.code.replace(/<\/script/gi, '<\\/script');
            html = html.replace(tag, () => `<script type="module">${code}</script>`);
          } else if (file.type === 'asset' && fileName.endsWith('.css')) {
            html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
          } else if (fileName !== 'index.html') {
            throw new Error(`${fileName} can't be part of a single-file build`);
          }
          delete bundle[fileName];
        }
        if (/(?:src|href)="\.\//.test(html)) throw new Error('index.html still refers to other files');
        this.emitFile({ type: 'asset', fileName: 'LightPDF.html', source: html });
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // `vite build --mode single` builds dist-single/LightPDF.html.
  const single = mode === 'single';
  return {
    // Relative asset paths so the built site works from any folder or subpath.
    base: './',
    publicDir: single ? false : 'public',
    resolve: single
      ? {
          alias: [
            { find: /^\.\/pdf-worker$/, replacement: fileURLToPath(new URL('src/browser/pdf-worker.single.ts', import.meta.url)) },
            { find: /^\.\/mupdf-module$/, replacement: fileURLToPath(new URL('src/browser/mupdf-module.single.ts', import.meta.url)) },
          ],
        }
      : undefined,
    build: {
      target: 'es2022',
      ...(single && {
        outDir: 'dist-single',
        modulePreload: false,
        // Inlines the files imported with ?url (PDF.js's WebAssembly decoders) as data: URLs.
        assetsInlineLimit: () => true,
        cssCodeSplit: false,
        rolldownOptions: { output: { codeSplitting: false } },
      }),
    },
    plugins: single ? [classicWorker(), mupdf(true), singleFile()] : [mupdf(false), serviceWorker()],
    test: {
      environment: 'node',
      include: ['tests/**/*.test.ts'],
    },
  };
});
