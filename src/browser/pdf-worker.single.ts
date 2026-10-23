import type { GlobalWorkerOptions } from 'pdfjs-dist';
// The same worker code as a plain (non-module) script; see classicWorker() in vite.config.ts.
import source from 'pdfjs-dist/build/pdf.worker.min.mjs?classic';

/**
 * PDF.js worker for the single-file build. A page opened from disk can't start
 * module workers, and PDF.js always asks for one, so module workers are started
 * as classic workers running the same code. PDF.js still creates and ends one
 * worker per document, as in the normal build.
 */
export function setUpWorker(options: typeof GlobalWorkerOptions): void {
  const workerUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  options.workerSrc = workerUrl;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url: string | URL, init?: WorkerOptions) {
      if (init?.type === 'module') super(workerUrl, { ...init, type: 'classic' });
      else super(url, init);
    }
  };
}
