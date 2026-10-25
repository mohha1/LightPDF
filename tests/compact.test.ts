import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { compactPdf } from '../src/core/compact';
import { Composer, type ComposeOptions } from '../src/core/compose';
import { makePdf } from './fixtures';

const OPTIONS: ComposeOptions = { imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 }, flatten: false };

/** Two pages of text in a whole embedded font (Liberation Sans, from PDF.js), as many PDF makers leave it. */
function embeddedFontPdf(): Uint8Array {
  const pdf = new mupdf.PDFDocument();
  const file = readFileSync(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url));
  const font = pdf.addSimpleFont(new mupdf.Font('LiberationSans', file));
  for (const line of ['Hello there', 'Second page']) {
    const resources = pdf.addObject({ Font: { F1: font } });
    pdf.insertPage(-1, pdf.addPage([0, 0, 612, 792], 0, resources, `BT /F1 24 Tf 40 700 Td (${line}) Tj ET`));
  }
  return pdf.saveToBuffer('compress').asUint8Array().slice();
}

/** Every page drawn by MuPDF, annotations and form fields included, as one fingerprint. */
function renders(bytes: Uint8Array): string {
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const hash = createHash('sha256');
  for (let i = 0; i < doc.countPages(); i++) {
    hash.update(doc.loadPage(i).toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).getPixels());
  }
  return hash.digest('hex');
}

async function text(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  let all = '';
  for (let n = 1; n <= doc.numPages; n++) {
    all += (await (await doc.getPage(n)).getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join('') + '\n';
  }
  await doc.loadingTask.destroy();
  return all;
}

describe('Compact compression', () => {
  it('keeps only the letters an embedded font is used for, and every page looks the same', async () => {
    const bytes = embeddedFontPdf();
    const compact = compactPdf(mupdf, bytes);
    expect(compact.length).toBeLessThan(bytes.length / 2);
    expect(renders(compact)).toEqual(renders(bytes));
    expect(await text(compact)).toBe('Hello there\nSecond page\n');
  });

  it('shares again what pages of one file added twice duplicated', async () => {
    const source = embeddedFontPdf();
    const composer = new Composer(new Map([['A', { kind: 'pdf', bytes: source }], ['B', { kind: 'pdf', bytes: source }]]), OPTIONS);
    const merged = await composer.compose(
      [
        { source: 'A', index: 0, rotation: 0 },
        { source: 'B', index: 1, rotation: 0 },
      ],
      'x',
    );
    const compact = compactPdf(mupdf, merged);
    expect(compact.length).toBeLessThan(merged.length / 3);
    expect(renders(compact)).toEqual(renders(merged));
  });

  it('keeps form fields, their values and the properties', async () => {
    const doc = await PDFDocument.load(await makePdf(1));
    const field = doc.getForm().createTextField('name');
    field.setText('Ada');
    field.addToPage(doc.getPage(0), { x: 10, y: 10, width: 80, height: 20 });
    doc.setTitle('Kept title');
    const compact = compactPdf(mupdf, await doc.save());
    const after = await PDFDocument.load(compact, { updateMetadata: false });
    expect(after.getForm().getTextField('name').getText()).toBe('Ada');
    expect(after.getTitle()).toBe('Kept title');
    expect(await text(compact)).toContain('Page 1');
  });
});
