import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import jbig2Url from 'pdfjs-dist/wasm/jbig2.wasm?url';
import openjpegUrl from 'pdfjs-dist/wasm/openjpeg.wasm?url';
import { setUpWorker } from './pdf-worker';

type PdfJs = typeof import('pdfjs-dist');

let library: Promise<PdfJs> | undefined;

/** Loads PDF.js on first use so the home page stays small. */
function pdfjs(): Promise<PdfJs> {
  library ??= import('pdfjs-dist').then((lib) => {
    setUpWorker(lib.GlobalWorkerOptions);
    return lib;
  });
  return library;
}

/** PDF.js's WebAssembly image decoders: JPEG 2000, and JBIG2 and CCITT fax (black-and-white scans). */
const WASM_FILES: Record<string, string> = { 'openjpeg.wasm': openjpegUrl, 'jbig2.wasm': jbig2Url };

/**
 * Gives PDF.js the decoders bundled with the app, which it asks for by file
 * name. The single-file build inlines them as data: URLs, which can be fetched
 * from a page opened from disk too.
 */
class BinaryDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = kind === 'wasmUrl' ? WASM_FILES[filename] : undefined;
    if (!url) throw new Error(`${filename} is not bundled with LightPDF.`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${filename}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  try {
    // PDF.js takes ownership of the buffer it is given, so pass a copy.
    return await lib.getDocument({ data: bytes.slice(), BinaryDataFactory }).promise;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('This file could not be read as a PDF. It may be damaged or not a PDF.');
  }
}

/** Largest canvas side we render, to stay within browser canvas limits. */
const MAX_CANVAS_SIDE = 6000;

/**
 * Renders a page onto a new canvas on a white background. `scale` is in
 * pixels per point (1 = 72 DPI) and is reduced if the canvas would be huge.
 */
export async function renderPage(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const base = page.getViewport({ scale: 1 });
  const safeScale = Math.min(scale, MAX_CANVAS_SIDE / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: safeScale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser could not create a drawing surface.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Renders a page so that it fits within a square of `size` CSS pixels. */
export async function renderThumbnail(page: PDFPageProxy, size: number): Promise<string> {
  const base = page.getViewport({ scale: 1 });
  const scale = (size * Math.min(window.devicePixelRatio || 1, 2)) / Math.max(base.width, base.height);
  const canvas = await renderPage(page, scale);
  const url = canvas.toDataURL('image/jpeg', 0.8);
  canvas.width = canvas.height = 0;
  return url;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Your browser could not encode the image.'))),
      type,
      quality,
    );
  });
}

/** Extracts the text of every page, separating pages with a blank line. */
export async function extractText(bytes: Uint8Array, onProgress?: (fraction: number) => void): Promise<string> {
  const doc = await openPdf(bytes);
  try {
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      }
      pages.push(text.trim());
      page.cleanup();
      onProgress?.(number / doc.numPages);
    }
    return pages.join('\n\n');
  } finally {
    await doc.loadingTask.destroy();
  }
}
