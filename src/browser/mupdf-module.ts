import type { MuPDFLibrary } from '../core/redact';

/** Imports MuPDF once its WebAssembly is set up (see mupdf.ts). */
export const importMupdf = (): Promise<MuPDFLibrary> => import('mupdf');
