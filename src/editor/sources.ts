import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isPdf, readBytes } from '../browser/files';
import { openPdf, renderThumbnail } from '../browser/pdfjs';

export interface Source {
  id: string;
  file: File;
  kind: 'pdf' | 'image';
  pageCount: number;
}

/** Thumbnails are rendered once at this size and scaled with CSS for zooming. */
const THUMB_SIZE = 260;
/** How many thumbnails render at the same time. */
const CONCURRENCY = 2;

let counter = 0;

/**
 * The files added to the editor. PDFs stay open in PDF.js for the whole
 * session so thumbnails render without re-reading the file.
 */
export class SourceRegistry {
  private sources = new Map<string, Source>();
  private pdfs = new Map<string, PDFDocumentProxy>();
  private imageUrls = new Map<string, string>();
  private thumbs = new Map<string, Promise<string>>();
  private ready = new Map<string, string>();
  private queue: Array<() => void> = [];
  private active = 0;

  /** Opens a file. Throws a readable error for damaged or protected PDFs. */
  async add(file: File): Promise<Source> {
    const id = `s${++counter}`;
    let source: Source;
    if (isPdf(file)) {
      const pdf = await openPdf(await readBytes(file));
      this.pdfs.set(id, pdf);
      source = { id, file, kind: 'pdf', pageCount: pdf.numPages };
    } else {
      const url = URL.createObjectURL(file);
      await checkImage(url, file.name);
      this.imageUrls.set(id, url);
      this.ready.set(`${id}:0`, url);
      source = { id, file, kind: 'image', pageCount: 1 };
    }
    this.sources.set(id, source);
    return source;
  }

  get(id: string): Source | undefined {
    return this.sources.get(id);
  }

  /** A thumbnail that is already rendered, if any. */
  cachedThumbnail(id: string, index: number): string | undefined {
    return this.ready.get(`${id}:${index}`);
  }

  thumbnail(id: string, index: number): Promise<string> {
    const key = `${id}:${index}`;
    const cached = this.ready.get(key);
    if (cached) return Promise.resolve(cached);
    let pending = this.thumbs.get(key);
    if (!pending) {
      pending = this.limit(async () => {
        const pdf = this.pdfs.get(id);
        if (!pdf) throw new Error('This file is no longer open.');
        const page = await pdf.getPage(index + 1);
        const url = await renderThumbnail(page, THUMB_SIZE);
        page.cleanup();
        this.ready.set(key, url);
        return url;
      });
      this.thumbs.set(key, pending);
      // Allow a retry later if rendering failed.
      pending.catch(() => this.thumbs.delete(key));
    }
    return pending;
  }

  /** Closes every file. */
  clear(): void {
    this.pdfs.forEach((pdf) => void pdf.loadingTask.destroy());
    this.imageUrls.forEach((url) => URL.revokeObjectURL(url));
    this.sources.clear();
    this.pdfs.clear();
    this.imageUrls.clear();
    this.thumbs.clear();
    this.ready.clear();
  }

  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function checkImage(url: string, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`"${name}" is not an image your browser can open.`));
    image.src = url;
  });
}
