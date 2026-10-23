import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { addPageNumbers, addWatermark, displayToUser, formatPageNumber, hexToRgb } from '../src/core/stamp';
import { makePdf } from './fixtures';

const box = { x: 10, y: 20, width: 100, height: 200 };

describe('displayToUser', () => {
  it('maps the displayed bottom-left corner for each rotation', () => {
    // The displayed bottom-left corner is a different user-space corner per rotation.
    expect(displayToUser(box, 0, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(displayToUser(box, 90, 0, 0)).toEqual({ x: 110, y: 20 });
    expect(displayToUser(box, 180, 0, 0)).toEqual({ x: 110, y: 220 });
    expect(displayToUser(box, 270, 0, 0)).toEqual({ x: 10, y: 220 });
  });

  it('maps the displayed top-right corner for each rotation', () => {
    expect(displayToUser(box, 0, 100, 200)).toEqual({ x: 110, y: 220 });
    // Rotated a quarter turn, the displayed page is 200 wide and 100 tall.
    expect(displayToUser(box, 90, 200, 100)).toEqual({ x: 10, y: 220 });
    expect(displayToUser(box, 180, 100, 200)).toEqual({ x: 10, y: 20 });
    expect(displayToUser(box, 270, 200, 100)).toEqual({ x: 110, y: 20 });
  });
});

describe('formatPageNumber', () => {
  it('fills in placeholders', () => {
    expect(formatPageNumber('Page {n} of {total}', 3, 9)).toBe('Page 3 of 9');
  });
});

describe('hexToRgb', () => {
  it('parses hex colours and falls back to black', () => {
    expect(hexToRgb('#ff8000')).toMatchObject({ red: 1, green: 128 / 255, blue: 0 });
    expect(hexToRgb('nope')).toMatchObject({ red: 0, green: 0, blue: 0 });
  });
});

async function contentLength(bytes: Uint8Array, pageIndex: number): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  const contents = doc.getPage(pageIndex).node.Contents();
  return contents ? contents.toString().length : 0;
}

describe('addPageNumbers', () => {
  it('stamps only the selected pages', async () => {
    const source = await makePdf(3, { rotations: [0, 90, 0] });
    const out = await addPageNumbers(source, {
      position: 'bottom-right',
      margin: 20,
      startAt: 1,
      format: 'Page {n} of {total}',
      fontSize: 10,
      color: '#000000',
      pages: [0, 1],
    });
    const before = await Promise.all([0, 1, 2].map((i) => contentLength(source, i)));
    const after = await Promise.all([0, 1, 2].map((i) => contentLength(out, i)));
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(after[1]).toBeGreaterThan(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it('explains unsupported characters', async () => {
    await expect(
      addPageNumbers(await makePdf(1), {
        position: 'bottom-center',
        margin: 20,
        startAt: 1,
        format: '页 {n}',
        fontSize: 10,
        color: '#000000',
      }),
    ).rejects.toThrow(/can't display/);
  });
});

describe('addWatermark', () => {
  it('stamps every page in both layouts', async () => {
    const source = await makePdf(2, { rotations: [0, 270] });
    for (const layout of ['center', 'tile'] as const) {
      const out = await addWatermark(source, {
        text: 'CONFIDENTIAL',
        fontSize: 20,
        color: '#ff0000',
        opacity: 0.3,
        rotation: 45,
        layout,
      });
      expect(await contentLength(out, 0)).toBeGreaterThan(await contentLength(source, 0));
      expect(await contentLength(out, 1)).toBeGreaterThan(await contentLength(source, 1));
    }
  });

  it('requires text', async () => {
    await expect(
      addWatermark(await makePdf(1), { text: ' ', fontSize: 20, color: '#000', opacity: 1, rotation: 0, layout: 'center' }),
    ).rejects.toThrow(/Type the text/);
  });
});
