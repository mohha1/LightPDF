import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';
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

  it('can leave the page showing instead of a black box, and mix both on a page', async () => {
    // A light blue page with "Name: moha" and, lower down, "Phone: 0123".
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawRectangle({ x: 0, y: 0, width: 300, height: 200, color: rgb(0.9, 0.95, 1) });
    page.drawText('Name: moha', { x: 20, y: 150, size: 14, font });
    page.drawText('Phone: 0123', { x: 20, y: 60, size: 14, font });
    const bytes = await doc.save();

    // Boxes in page coordinates, top down: over "moha" (blank) and over "0123" (black).
    const blank: Mark = { type: 'redact', id: 'b', x: 64, y: 34, width: 60, height: 24, blank: true };
    const black: Mark = { type: 'redact', id: 'k', x: 66, y: 124, width: 60, height: 24 };
    const out = await redact(bytes, [{ source: 'S', index: 0, rotation: 0, marks: [blank, black] }]);
    const all = await everything(out);
    expect(all).not.toContain('moha');
    expect(all).not.toContain('0123');
    expect(await visibleText(out)).toMatch(/Name:\s*Phone:/);

    const rendered = mupdf.Document.openDocument(out, 'application/pdf').loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
    const pixel = (x: number, y: number) => {
      const index = y * rendered.getStride() + x * rendered.getNumberOfComponents();
      return [...rendered.getPixels().slice(index, index + 3)];
    };
    expect(pixel(95, 46)).toEqual(pixel(250, 10)); // where "moha" was: the page's own blue
    expect(pixel(95, 136)).toEqual([0, 0, 0]); // where "0123" was: black
  });

  it('fills a blank box on a scan with paper, not white, and puts nothing back', async () => {
    // A "scan": the whole page is a picture of yellowed paper with a black bar of ink.
    const W = 600;
    const H = 400;
    const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false);
    const pixels = pixmap.getPixels();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const ink = x > 200 && x < 320 && y > 180 && y < 210;
        pixels.set(ink ? [20, 20, 20] : [236 - y / 25, 222 - y / 25, 180], y * pixmap.getStride() + x * 3);
      }
    }
    const png = pixmap.asPNG();

    for (const rotation of [0, 90]) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([300, 200]);
      page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 300, height: 200 });
      if (rotation) page.setRotation(degrees(rotation));
      // Over the ink bar (page x 100–160, y 90–105 top down), as shown.
      const marks: Mark[] = [rotation ? { type: 'redact', id: 'b', x: 90, y: 90, width: 20, height: 70, blank: true } : { type: 'redact', id: 'b', x: 90, y: 85, width: 80, height: 30, blank: true }];
      const out = await redact(await doc.save(), [{ source: 'S', index: 0, rotation: 0, marks }]);

      const shown = mupdf.Document.openDocument(out, 'application/pdf').loadPage(0).toPixmap(mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, false, true);
      const at = (x: number, y: number) => {
        const i = y * shown.getStride() + x * shown.getNumberOfComponents();
        return [...shown.getPixels().slice(i, i + 3)];
      };
      const [centreX, centreY] = rotation ? [100, 125] : [130, 100];
      const middle = at(centreX, centreY);
      const beside = rotation ? at(centreX, 60) : at(60, centreY);
      // Paper-coloured, close to the paper beside it: not white, not ink.
      expect(middle[2], `rotation ${rotation}`).toBeLessThan(200);
      for (let c = 0; c < 3; c++) expect(Math.abs(middle[c] - beside[c]), `rotation ${rotation}`).toBeLessThan(14);
    }
  });

  it('does not fail when a box only grazes a letter beside the ones it covers', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('ABCDEFGH', { x: 20, y: 100, size: 20, font });
    const from = 20 + font.widthOfTextAtSize('AB', 20);
    // Over C to F, and half a point into G's spacing box: MuPDF leaves G, and that is right.
    const width = font.widthOfTextAtSize('CDEF', 20) + 0.5;
    for (const blank of [false, true]) {
      const out = await redact(await doc.save(), [{ source: 'S', index: 0, rotation: 0, marks: [{ type: 'redact', id: 'g', x: from, y: 70, width, height: 40, blank }] }]);
      expect((await visibleText(out)).replace(/\s/g, '')).toBe('ABGH');
    }
  });

  it('adds no paper where the page already shows through', async () => {
    const out = await redact(await secretPdf(), [{ source: 'S', index: 0, rotation: 0, marks: [{ ...box(0, 120, 300, 80), blank: true } as Mark] }]);
    expect(await everything(out)).not.toContain('LightPDFPaper');
    expect(await everything(out)).not.toContain('SECRET');
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
