import type * as MuPDF from 'mupdf';

export type MuPDFLibrary = typeof MuPDF;

type Box = [number, number, number, number];

const intersects = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Applies the /Redact annotations that MarkPainter put on the pages, with
 * MuPDF: text, image pixels and drawings under each box are removed from the
 * file (not covered), and the box is filled black.
 *
 * It fails closed: if any character is still found under a box afterwards,
 * it throws rather than hand back a file that only looks redacted. Saving
 * with garbage collection drops the objects the removed content lived in.
 */
export function applyRedactions(mupdf: MuPDFLibrary, bytes: Uint8Array): Uint8Array {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = opened.asPDF();
    if (!pdf) throw new Error('This document could not be redacted.');
    let redacted = 0;
    for (let index = 0; index < pdf.countPages(); index++) {
      const page = pdf.loadPage(index) as MuPDF.PDFPage;
      const boxes = page
        .getAnnotations()
        .filter((annotation) => annotation.getType() === 'Redact')
        .map((annotation) => annotation.getRect() as Box);
      if (boxes.length === 0) continue;
      page.applyRedactions(
        true,
        mupdf.PDFPage.REDACT_IMAGE_PIXELS,
        mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
        mupdf.PDFPage.REDACT_TEXT_REMOVE,
      );
      // Check a freshly loaded page: what is in the file now.
      const after = pdf.loadPage(index) as MuPDF.PDFPage;
      let left = '';
      after.toStructuredText('preserve-whitespace').walk({
        onChar(char, _origin, _font, _size, quad) {
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          if (char.trim() && boxes.some((area) => intersects(box, area))) left += char;
        },
      });
      if (left) throw new Error(`Redaction failed on page ${index + 1}: some text under a box could not be removed, so nothing was saved.`);
      if (after.getAnnotations().some((annotation) => annotation.getType() === 'Redact')) {
        throw new Error(`Redaction failed on page ${index + 1}, so nothing was saved.`);
      }
      redacted += boxes.length;
    }
    if (redacted === 0) return bytes;
    // garbage=4 drops unused objects (the old content) and merges duplicates; clean rewrites content streams.
    return pdf.saveToBuffer('garbage=4,compress,clean').asUint8Array().slice();
  } finally {
    opened.destroy();
  }
}
