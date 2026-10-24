import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Composer, type ComposeOptions, type ComposePage, type ComposeSource } from '../src/core/compose';
import { PDFDocument } from 'pdf-lib';
import { FONTS, PageView, STAMP, type Mark, type TextMark } from '../src/core/marks';
import { fromBase64, JPEG_BASE64, makePdf, PNG_BASE64 } from './fixtures';

const OPTIONS: ComposeOptions = {
  imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 },
  flatten: false,
};

async function sources(): Promise<Map<string, ComposeSource>> {
  return new Map<string, ComposeSource>([
    // Page 2 of A has /Rotate 90.
    ['A', { kind: 'pdf', bytes: await makePdf(3, { rotations: [0, 90, 0] }) }],
    ['J', { kind: 'image', image: { bytes: fromBase64(JPEG_BASE64), kind: 'jpg' } }],
  ]);
}

function label(text: string, x: number, y: number, extra: Partial<TextMark> = {}): TextMark {
  return { type: 'text', id: text, text, font: 'sans', bold: false, size: 10, color: '#000000', x, y, width: 0, height: 0, angle: 0, ...extra };
}

interface Found {
  text: string;
  /** The baseline origin as a viewer shows the page, y down. */
  x: number;
  y: number;
  /** Direction of the text on screen, in degrees clockwise. */
  direction: number;
}

/** The text of each page with where a viewer shows it. */
async function readPages(bytes: Uint8Array): Promise<Found[][]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
  const pages: Found[][] = [];
  for (let number = 1; number <= doc.numPages; number++) {
    const page = await doc.getPage(number);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push(
      content.items.flatMap((item) => {
        if (!('str' in item) || !item.str.trim()) return [];
        const [a, b, , , e, f] = pdfjs.Util.transform(viewport.transform, item.transform);
        const direction = Math.round((Math.atan2(b, a) * 180) / Math.PI);
        return [{ text: item.str, x: e, y: f, direction: (direction + 360) % 360 }];
      }),
    );
  }
  await doc.loadingTask.destroy();
  return pages;
}

const find = (page: Found[], text: string) => page.find((item) => item.text === text);

describe('marks at export', () => {
  it('puts text where the editor showed it, on plain, turned and extra-rotated pages', async () => {
    const mark = label('Note', 10, 20);
    const baseline = 20 + 10 * FONTS.sans.baseline;
    const composer = new Composer(await sources(), OPTIONS);
    const out = await composer.compose(
      [
        { source: 'A', index: 0, rotation: 0, marks: [mark] },
        { source: 'A', index: 1, rotation: 0, marks: [mark] },
        { source: 'A', index: 0, rotation: 90, marks: [mark] },
      ],
      'x',
    );
    const [plain, turned, rotated] = await readPages(out);
    expect(find(plain, 'Note')).toMatchObject({ direction: 0 });
    expect(find(plain, 'Note')!.x).toBeCloseTo(10, 1);
    expect(find(plain, 'Note')!.y).toBeCloseTo(baseline, 1);

    // A page with its own /Rotate: marks follow the page as viewers show it.
    expect(find(turned, 'Note')).toMatchObject({ direction: 0 });
    expect(find(turned, 'Note')!.x).toBeCloseTo(10, 1);
    expect(find(turned, 'Note')!.y).toBeCloseTo(baseline, 1);

    // Turned in the editor afterwards, the text turns with the page.
    const expected = new PageView({ width: 100, height: 200 }, 90).toView({ x: 10, y: baseline });
    expect(find(rotated, 'Note')).toMatchObject({ direction: 90 });
    expect(find(rotated, 'Note')!.x).toBeCloseTo(expected.x, 1);
    expect(find(rotated, 'Note')!.y).toBeCloseTo(expected.y, 1);
  });

  it('keeps text typed on a turned page upright', async () => {
    // Typed while the page was shown turned a quarter clockwise: the text is turned back.
    const view = new PageView({ width: 100, height: 200 }, 90);
    const origin = view.fromView({ x: 30, y: 10 });
    const mark = label('Up', origin.x, origin.y, { angle: 270 });
    const out = await new Composer(await sources(), OPTIONS).compose([{ source: 'A', index: 0, rotation: 90, marks: [mark] }], 'x');
    const [page] = await readPages(out);
    expect(find(page, 'Up')).toMatchObject({ direction: 0 });
    expect(find(page, 'Up')!.x).toBeCloseTo(30, 1);
    expect(find(page, 'Up')!.y).toBeCloseTo(10 + 10 * FONTS.sans.baseline, 1);
  });

  it('keeps copies of the same page apart', async () => {
    const composer = new Composer(await sources(), OPTIONS);
    const out = await composer.compose(
      [
        { source: 'A', index: 0, rotation: 0, marks: [label('One', 10, 10)] },
        { source: 'A', index: 0, rotation: 0, marks: [label('Two', 10, 10)] },
        { source: 'A', index: 0, rotation: 0 },
      ],
      'x',
    );
    const texts = (await readPages(out)).map((page) => page.map((item) => item.text).filter((text) => !text.startsWith('Page')));
    expect(texts).toEqual([['One'], ['Two'], []]);
  });

  it('scales marks with an image page laid out on paper', async () => {
    // The 4x2 px image is 3x1.5 points; on A4 it is scaled to fill the width.
    const options: ComposeOptions = { ...OPTIONS, imageLayout: { pageSize: 'a4', orientation: 'landscape', margin: 0 } };
    const out = await new Composer(await sources(), options).compose([{ source: 'J', index: 0, rotation: 0, marks: [label('I', 0, 0, { size: 1 })] }], 'x');
    const [page] = await readPages(out);
    const scale = 841.89 / 3;
    const top = (595.28 - 1.5 * scale) / 2;
    expect(find(page, 'I')!.x).toBeCloseTo(0, 1);
    expect(find(page, 'I')!.y).toBeCloseTo(top + FONTS.sans.baseline * scale, 0);
  });

  it('draws every kind of mark', async () => {
    const marks: Mark[] = [
      { type: 'rect', id: 'r', x: 5, y: 5, width: 20, height: 10, color: '#d92d20', filled: false, lineWidth: 2 },
      { type: 'ellipse', id: 'e', x: 5, y: 30, width: 20, height: 10, color: '#1f5fd1', filled: true, lineWidth: 2 },
      { type: 'whiteout', id: 'w', x: 5, y: 50, width: 40, height: 10, color: '#ffffff' },
      { type: 'highlight', id: 'h', x: 5, y: 70, width: 40, height: 10, color: '#ffe14d' },
      { type: 'line', id: 'l', from: { x: 5, y: 90 }, to: { x: 60, y: 90 }, arrow: true, color: '#111111', lineWidth: 2 },
      { type: 'ink', id: 'i', points: [{ x: 5, y: 100 }, { x: 10, y: 105 }, { x: 20, y: 100 }], color: '#111111', lineWidth: 3 },
      { type: 'image', id: 'p', image: { bytes: fromBase64(PNG_BASE64), kind: 'png' }, x: 50, y: 120, width: 30, height: 50, angle: 90 },
      label('Bold', 10, 150, { font: 'serif', bold: true }),
      label('Code', 10, 170, { font: 'mono' }),
      { type: 'stamp', id: 's', text: 'APPROVED', color: '#d92d20', x: 10, y: 10, width: 80, height: 20, angle: 0 },
      { type: 'symbol', id: 'k', symbol: 'check', color: '#111111', x: 70, y: 30, width: 12, height: 12 },
      { type: 'symbol', id: 'c', symbol: 'cross', color: '#111111', x: 70, y: 50, width: 12, height: 12 },
      { type: 'symbol', id: 'd', symbol: 'dot', color: '#111111', x: 70, y: 70, width: 12, height: 12 },
    ];
    const pages: ComposePage[] = [{ source: 'A', index: 2, rotation: 0, marks }];
    const plain = await new Composer(await sources(), OPTIONS).compose([{ source: 'A', index: 2, rotation: 0 }], 'x');
    const marked = await new Composer(await sources(), OPTIONS).compose(pages, 'x');
    expect(marked.length).toBeGreaterThan(plain.length + 500);
    const [page] = await readPages(marked);
    expect(page.map((item) => item.text)).toEqual(expect.arrayContaining(['Bold', 'Code', 'APPROVED']));
    // The stamp's text is centred in its frame.
    const stamp = find(page, 'APPROVED')!;
    expect(stamp.x).toBeGreaterThan(10);
    expect(stamp.y).toBeCloseTo(20 + 20 * STAMP.text * 0.36, 0);
  });

  it('crops to what the editor showed, on plain and turned pages', async () => {
    const crop: Mark = { type: 'crop', id: 'c', x: 10, y: 20, width: 50, height: 60 };
    const turnedCrop: Mark = { type: 'crop', id: 'c', x: 0, y: 0, width: 100, height: 50 };
    const out = await new Composer(await sources(), OPTIONS).compose(
      [
        { source: 'A', index: 0, rotation: 0, marks: [crop] },
        { source: 'A', index: 1, rotation: 0, marks: [turnedCrop] },
      ],
      'x',
    );
    const doc = await PDFDocument.load(out);
    expect(doc.getPage(0).getCropBox()).toEqual({ x: 10, y: 120, width: 50, height: 60 });
    // /Rotate 90: the top-left 100 × 50 as shown is the bottom-left 50 × 100 of the page itself.
    expect(doc.getPage(1).getCropBox()).toEqual({ x: 0, y: 0, width: 50, height: 100 });
  });

  it('explains text the built-in fonts cannot write', async () => {
    const composer = new Composer(await sources(), OPTIONS);
    await expect(composer.compose([{ source: 'A', index: 0, rotation: 0, marks: [label('Привет', 10, 10)] }], 'x')).rejects.toThrow(
      /built-in fonts/,
    );
  });
});
