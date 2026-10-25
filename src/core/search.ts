import type { Rect } from './marks';
import type { MuPDFLibrary } from './redact';

/**
 * Where `needle` appears on each of the given pages of a PDF, ignoring case:
 * one rectangle per line of each match, in the page editor's marks space
 * (points, y down, the page as viewers show it), which is MuPDF's page space.
 */
export function findText(mupdf: MuPDFLibrary, bytes: Uint8Array, indices: readonly number[], needle: string): Map<number, Rect[]> {
  const found = new Map<number, Rect[]>();
  if (!needle.trim()) return found;
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const count = opened.countPages();
    for (const index of new Set(indices)) {
      if (index < 0 || index >= count) continue;
      const page = opened.loadPage(index);
      const rects = page.search(needle, 'ignore-case').flatMap((hit) =>
        hit.map((quad) => {
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          const [x, y] = [Math.min(...xs), Math.min(...ys)];
          return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
        }),
      );
      page.destroy();
      if (rects.length) found.set(index, rects);
    }
  } finally {
    opened.destroy();
  }
  return found;
}
