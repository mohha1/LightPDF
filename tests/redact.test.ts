import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Composer, type ComposeOptions, type ComposePage } from '../src/core/compose';
import type { Mark } from '../src/core/marks';
import { applyRedactions, type MuPDFLibrary } from '../src/core/redact';
import { everything } from './fixtures';

const OPTIONS: ComposeOptions = { imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 }, flatten: false };

/**
 * A 300 × 200 page with a public line and a secret line, a form field holding
 * a secret value and a link with a secret address, all in the lower half
 * (page y 120–170, top-down), so a box over that half covers them.
 */
async function secretPdf(rotation = 0): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Public heading', { x: 20, y: 160, size: 14, font });
  page.drawText('Account SECRET-4711', { x: 20, y: 60, size: 14, font });
  const field = doc.getForm().createTextField('ssn');
  field.setText('FIELD-SECRET-99');
  field.addToPage(page, { x: 160, y: 30, width: 120, height: 24 });
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [20, 30, 140, 50],
    A: { S: 'URI', URI: doc.context.obj('https://example.com/LINK-SECRET') },
  });
  page.node.addAnnot(doc.context.register(link));
  if (rotation) page.setRotation(degrees(rotation));
  return doc.save();
}

const box = (x: number, y: number, width: number, height: number): Mark => ({ type: 'redact', id: `r${x}${y}`, x, y, width, height });

async function redact(bytes: Uint8Array, pages: ComposePage[], library: MuPDFLibrary = mupdf): Promise<Uint8Array> {
  const composer = new Composer(new Map([['S', { kind: 'pdf', bytes }]]), OPTIONS);
  return applyRedactions(library, await composer.compose(pages, 'x'));
}

async function visibleText(bytes: Uint8Array): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  await doc.loadingTask.destroy();
  return text;
}

describe('redaction', () => {
  it('removes text, form values and link addresses from the file, not just from view', async () => {
    const before = await everything(await secretPdf());
    expect(before).toContain('SECRET-4711');
    expect(before).toContain('FIELD-SECRET-99');
    expect(before).toContain('LINK-SECRET');

    const out = await redact(await secretPdf(), [{ source: 'S', index: 0, rotation: 0, marks: [box(0, 120, 300, 80)] }]);
    const all = await everything(out);
    expect(all).not.toContain('SECRET');
    expect(all).not.toContain('4711');
    expect(await visibleText(out)).toContain('Public heading');
  });

  it('finds the right place on a page with its own rotation and one rotated in the editor', async () => {
    // /Rotate 90: shown 200 wide and 300 tall; the secret line runs down the left part.
    for (const [own, extra] of [
      [90, 0],
      [0, 90],
    ]) {
      const marks = own ? [box(0, 0, 80, 300)] : [box(0, 120, 300, 80)];
      const out = await redact(await secretPdf(own), [{ source: 'S', index: 0, rotation: extra, marks }]);
      const all = await everything(out);
      expect(all, `rotation ${own}+${extra}`).not.toContain('4711');
      expect(await visibleText(out)).toContain('Public heading');
    }
  });

  it('leaves files without boxes untouched', async () => {
    const bytes = await secretPdf();
    const composed = await new Composer(new Map([['S', { kind: 'pdf', bytes }]]), OPTIONS).compose([{ source: 'S', index: 0, rotation: 0 }], 'x');
    expect(applyRedactions(mupdf, composed)).toBe(composed);
  });

  it('fails closed: if text is still under a box, nothing is handed back', async () => {
    // A MuPDF whose redaction silently does nothing.
    const broken = {
      ...mupdf,
      Document: {
        openDocument(...args: Parameters<typeof mupdf.Document.openDocument>) {
          const opened = mupdf.Document.openDocument(...args);
          const pdf = opened.asPDF()!;
          const loadPage = pdf.loadPage.bind(pdf);
          Object.assign(pdf, { loadPage: (index: number) => Object.assign(loadPage(index), { applyRedactions() {} }) });
          return opened;
        },
      },
    } as unknown as MuPDFLibrary;
    await expect(redact(await secretPdf(), [{ source: 'S', index: 0, rotation: 0, marks: [box(0, 120, 300, 80)] }], broken)).rejects.toThrow(
      /Redaction failed on page 1/,
    );
  });
});
