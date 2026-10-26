import { describe, expect, it } from 'vitest';
import * as mupdf from 'mupdf';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Composer, type ComposeOptions } from '../src/core/compose';
import type { Mark } from '../src/core/marks';
import { applyRedactions } from '../src/core/redact';
import { findText } from '../src/core/search';
import { everything } from './fixtures';

const OPTIONS: ComposeOptions = { imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 }, flatten: false };

/** Pages naming Moha in different cases, one with its own rotation, one with a crop box that doesn't start at 0. */
async function letters(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [rotation, crop] of [
    [0, false],
    [90, false],
    [0, true],
  ] as const) {
    const page = doc.addPage([300, 200]);
    page.drawText('Dear Moha, thank you.', { x: 20, y: 150, size: 14, font });
    page.drawText('Signed: MOHA and friends', { x: 20, y: 60, size: 14, font });
    if (rotation) page.setRotation(degrees(rotation));
    if (crop) page.setCropBox(10, 10, 280, 180);
  }
  return doc.save();
}

async function visibleText(bytes: Uint8Array, number: number): Promise<string> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const page = await doc.getPage(number);
  const text = (await page.getTextContent()).items.map((item) => ('str' in item ? item.str : '')).join(' ');
  await doc.loadingTask.destroy();
  return text;
}

describe('finding text to redact', () => {
  it('finds every place a word appears, ignoring case, on the pages asked for', async () => {
    const found = findText(mupdf, await letters(), [0, 2], 'moha');
    expect([...found.keys()]).toEqual([0, 2]);
    expect(found.get(0)).toHaveLength(2);
    // Upright page, top down: "Moha" in the first line (baseline at 50), after "Dear ".
    const [first] = found.get(0)!;
    expect(first.y).toBeLessThan(50);
    expect(first.y + first.height).toBeGreaterThan(50);
    expect(first.x).toBeGreaterThan(40);
    expect(findText(mupdf, await letters(), [0], 'nobody').size).toBe(0);
    expect(findText(mupdf, await letters(), [0], '  ').size).toBe(0);
  });

  it('marks exactly the word: redacting what it finds removes it and keeps the rest, on turned and cropped pages too', async () => {
    const bytes = await letters();
    const found = findText(mupdf, bytes, [0, 1, 2], 'moha');
    const pages = [0, 1, 2].map((index) => ({
      source: 'S',
      index,
      rotation: 0,
      marks: found.get(index)!.map((rect, i): Mark => ({ type: 'redact', id: `r${index}-${i}`, ...rect })),
    }));
    const composed = await new Composer(new Map([['S', { kind: 'pdf', bytes }]]), OPTIONS).compose(pages, 'x');
    const out = applyRedactions(mupdf, composed);
    expect((await everything(out)).toLowerCase()).not.toContain('moha');
    for (const number of [1, 2, 3]) {
      const text = (await visibleText(out, number)).replace(/\s+/g, ' ');
      expect(text, `page ${number}`).toContain('Dear');
      expect(text, `page ${number}`).toContain('thank you.');
      expect(text, `page ${number}`).toContain('and friends');
    }
  });
});
