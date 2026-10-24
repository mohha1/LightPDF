import source from 'virtual:mupdf-source';
import type { MuPDFLibrary } from '../core/redact';

/**
 * The single-file build carries MuPDF as one module's source (see mupdf() in
 * vite.config.ts) and imports it from a blob: URL, which also works in a
 * page opened from disk.
 */
export async function importMupdf(): Promise<MuPDFLibrary> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    return (await import(/* @vite-ignore */ url)) as MuPDFLibrary;
  } finally {
    URL.revokeObjectURL(url);
  }
}
