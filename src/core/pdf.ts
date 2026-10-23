import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

export type Bytes = Uint8Array;

/** Loads a PDF, turning pdf-lib's errors into messages people can act on. */
export async function loadPdf(bytes: Bytes): Promise<PDFDocument> {
  try {
    // updateMetadata: false keeps the document's own producer and dates.
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('This PDF is password-protected. Remove the password and try again.');
    }
    throw new Error('This file could not be read as a PDF. It may be damaged or not a PDF.');
  }
}

/** Creates an empty document tagged as produced by LightPDF. */
export async function createPdf(): Promise<PDFDocument> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const now = new Date();
  doc.setCreator('LightPDF');
  doc.setProducer('LightPDF');
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  return doc;
}

export async function savePdf(doc: PDFDocument): Promise<Bytes> {
  return doc.save({ useObjectStreams: true });
}
