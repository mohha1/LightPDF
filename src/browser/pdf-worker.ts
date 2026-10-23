import type { GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Points PDF.js at its worker file. The single-file build uses pdf-worker.single.ts instead. */
export function setUpWorker(options: typeof GlobalWorkerOptions): void {
  options.workerSrc = workerUrl;
}
