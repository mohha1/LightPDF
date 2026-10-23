import { readBytes, isPdf } from '../browser/files';
import { openPdf, renderThumbnail } from '../browser/pdfjs';

export interface FileInfo {
  /** Image URL of the first page, or of the image itself. */
  thumbnail: string;
  /** Number of pages, for PDFs. */
  pageCount?: number;
}

const THUMB_SIZE = 180;
const PAGE_THUMB_SIZE = 150;

/** Runs at most `limit` tasks at a time so dropping 50 files doesn't stall the tab. */
function limiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

const limit = limiter(3);
const infoCache = new WeakMap<File, Promise<FileInfo>>();

/** Reads the page count and renders a thumbnail. Results are cached per file. */
export function fileInfo(file: File): Promise<FileInfo> {
  let info = infoCache.get(file);
  if (!info) {
    info = isPdf(file)
      ? limit(async () => {
          const doc = await openPdf(await readBytes(file));
          try {
            const page = await doc.getPage(1);
            return { thumbnail: await renderThumbnail(page, THUMB_SIZE), pageCount: doc.numPages };
          } finally {
            await doc.loadingTask.destroy();
          }
        })
      : Promise.resolve({ thumbnail: URL.createObjectURL(file) });
    infoCache.set(file, info);
  }
  return info;
}

const pageCache = new WeakMap<File, Map<number, string>>();

/**
 * Renders a thumbnail of every page, calling `onPage` as each one is ready.
 * Returns a function that stops rendering.
 */
export function renderPageThumbnails(file: File, onPage: (index: number, url: string) => void): () => void {
  let cancelled = false;
  let cache = pageCache.get(file);
  if (!cache) pageCache.set(file, (cache = new Map()));
  const known = cache;

  void (async () => {
    const doc = await openPdf(await readBytes(file));
    try {
      for (let index = 0; index < doc.numPages && !cancelled; index++) {
        let url = known.get(index);
        if (!url) {
          const page = await doc.getPage(index + 1);
          url = await renderThumbnail(page, PAGE_THUMB_SIZE);
          page.cleanup();
          known.set(index, url);
        }
        if (!cancelled) onPage(index, url);
      }
    } finally {
      await doc.loadingTask.destroy();
    }
  })().catch(() => {
    // The file's own error is already shown by fileInfo().
  });

  return () => {
    cancelled = true;
  };
}

export function cachedPageThumbnail(file: File, index: number): string | undefined {
  return pageCache.get(file)?.get(index);
}
