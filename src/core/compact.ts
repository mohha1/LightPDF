import type { MuPDFLibrary } from './redact';

/**
 * Makes a PDF smaller without changing how it looks, with MuPDF: drops
 * unused objects and merges duplicates (pages of one file added twice share
 * their fonts and images again), keeps only the letters each embedded font
 * is used for, compresses whatever isn't, and packs small objects into
 * compressed object streams. Text stays text; bookmarks, links and forms stay.
 */
export function compactPdf(mupdf: MuPDFLibrary, bytes: Uint8Array): Uint8Array {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = opened.asPDF();
    if (!pdf) throw new Error('This document could not be compressed.');
    // A form filled in later may need letters the file doesn't use yet, so its fonts stay whole.
    const fields = pdf.getTrailer().get('Root', 'AcroForm', 'Fields');
    if (!(fields.isArray() && fields.length > 0)) pdf.subsetFonts();
    return pdf.saveToBuffer('garbage=4,compress,compress-fonts,compress-images,objstms').asUint8Array().slice();
  } finally {
    opened.destroy();
  }
}
