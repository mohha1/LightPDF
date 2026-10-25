import wasmUrl from 'virtual:mupdf-wasm';
import type { MuPDFLibrary } from '../core/redact';
import { importMupdf } from './mupdf-module';

let library: Promise<MuPDFLibrary> | undefined;

/**
 * Loads MuPDF the first time it is needed: to redact, compress without
 * turning pages into images, find text, and add or remove passwords. Its
 * WebAssembly ships gzipped with the app (never from another site) and is
 * unzipped here.
 */
export function loadMupdf(): Promise<MuPDFLibrary> {
  library ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error('Part of LightPDF (MuPDF) could not be loaded. Reload the page and try again.');
    let wasmBinary = await response.arrayBuffer();
    // Gzipped, unless a server already unzipped it on the way.
    const [first, second] = new Uint8Array(wasmBinary, 0, 2);
    if (first === 0x1f && second === 0x8b) {
      wasmBinary = await new Response(new Blob([wasmBinary]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    }
    // MuPDF reads its settings from this global when its module starts.
    (globalThis as Record<string, unknown>).$libmupdf_wasm_Module = { wasmBinary };
    return importMupdf();
  })();
  library.catch(() => (library = undefined));
  return library;
}
