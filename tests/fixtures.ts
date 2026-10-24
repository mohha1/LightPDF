import {
  decodePDFRawStream,
  degrees,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  StandardFonts,
  type PDFObject,
} from 'pdf-lib';

/** 4x2 px JPEG whose EXIF orientation is 6 (rotate 90° clockwise to display). */
export const JPEG_ROTATED_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4QAiRXhpZgAATU0AKgAAAAgAAQESAAMAAAABAAYAAAAAAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=';

/** 4x2 px JPEG without EXIF data. */
export const JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=';

/** 3x5 px semi-transparent PNG. */
export const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAAFCAYAAACAcVaiAAAAFUlEQVR4nGNkqPjfwAAFTAxIgEgOAHtQAgEglNzYAAAAAElFTkSuQmCC';

export function fromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/**
 * Builds a PDF whose pages have distinct widths (100, 101, 102, ...) so tests
 * can tell pages apart after reordering. Each page also carries its label.
 */
export async function makePdf(pageCount: number, options: { title?: string; rotations?: number[] } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([100 + i, 200]);
    page.drawText(`Page ${i + 1}`, { x: 10, y: 100, size: 12, font });
    const rotation = options.rotations?.[i];
    if (rotation) page.setRotation(degrees(rotation));
  }
  if (options.title) doc.setTitle(options.title);
  return doc.save();
}

/** Page widths of a PDF, which identify the source pages made by makePdf. */
export async function pageWidths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

export async function pageRotations(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getRotation().angle);
}

/**
 * Every piece of text anywhere in a PDF's objects: decoded strings, names
 * and the decompressed contents of every stream, reachable or not. Used to
 * prove that removed content is really gone from the file.
 */
export async function everything(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const parts: string[] = [];
  const visit = (object: PDFObject | undefined, depth = 0) => {
    if (!object || depth > 50) return;
    if (object instanceof PDFString || object instanceof PDFHexString) parts.push(object.decodeText());
    else if (object instanceof PDFName) parts.push(object.decodeText());
    else if (object instanceof PDFArray) object.asArray().forEach((item) => visit(item, depth + 1));
    else if (object instanceof PDFDict) object.entries().forEach(([key, value]) => (visit(key, depth + 1), visit(value, depth + 1)));
    else if (object instanceof PDFRawStream) {
      visit(object.dict, depth + 1);
      let text: string;
      try {
        text = Buffer.from(decodePDFRawStream(object).decode()).toString('latin1');
      } catch {
        text = Buffer.from(object.contents).toString('latin1');
      }
      // Text drawn as hex strings, <48656C6C6F>, counts too.
      parts.push(text, ...[...text.matchAll(/<([0-9A-Fa-f\s]+)>/g)].map((match) => Buffer.from(match[1].replace(/\s/g, ''), 'hex').toString('latin1')));
    } else if (object instanceof PDFStream) visit(object.dict, depth + 1);
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  visit(doc.context.trailerInfo.Info);
  return parts.join('\n');
}
