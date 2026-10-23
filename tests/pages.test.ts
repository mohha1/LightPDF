import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractPages, mergePdfs, organizePages, removePages, rotatePages, splitPdf } from '../src/core/pages';
import { normalizeAngle } from '../src/core/angle';
import { loadPdf } from '../src/core/pdf';
import { makePdf, pageRotations, pageWidths } from './fixtures';

describe('mergePdfs', () => {
  it('appends all pages in order and reports progress', async () => {
    const progress: number[] = [];
    const merged = await mergePdfs([await makePdf(2), await makePdf(3)], (p) => progress.push(p));
    expect(await pageWidths(merged)).toEqual([100, 101, 100, 101, 102]);
    expect(progress).toEqual([0.5, 1]);
    const doc = await PDFDocument.load(merged, { updateMetadata: false });
    expect(doc.getProducer()).toBe('LightPDF');
  });
});

describe('extractPages', () => {
  it('keeps the requested pages in the requested order', async () => {
    expect(await pageWidths(await extractPages(await makePdf(4), [3, 0]))).toEqual([103, 100]);
  });
});

describe('splitPdf', () => {
  it('creates one document per group', async () => {
    const parts = await splitPdf(await makePdf(5), [[0, 1], [4]]);
    expect(await Promise.all(parts.map(pageWidths))).toEqual([[100, 101], [104]]);
  });
});

describe('removePages', () => {
  it('drops the given pages', async () => {
    expect(await pageWidths(await removePages(await makePdf(4), [1, 3]))).toEqual([100, 102]);
  });

  it('refuses to remove every page', async () => {
    await expect(removePages(await makePdf(2), [0, 1])).rejects.toThrow(/at least one page/);
  });

  it('keeps document metadata', async () => {
    const out = await removePages(await makePdf(2, { title: 'Report' }), [0]);
    expect((await PDFDocument.load(out)).getTitle()).toBe('Report');
  });
});

describe('rotatePages', () => {
  it('adds to the existing rotation of selected pages only', async () => {
    const source = await makePdf(3, { rotations: [0, 90, 270] });
    expect(await pageRotations(await rotatePages(source, 90))).toEqual([90, 180, 0]);
    expect(await pageRotations(await rotatePages(source, -90, [0]))).toEqual([270, 90, 270]);
  });
});

describe('organizePages', () => {
  it('reorders, rotates and drops pages', async () => {
    const out = await organizePages(await makePdf(3), [
      { index: 2, rotation: 180 },
      { index: 0, rotation: 0 },
    ]);
    expect(await pageWidths(out)).toEqual([102, 100]);
    expect(await pageRotations(out)).toEqual([180, 0]);
  });

  it('can duplicate pages', async () => {
    const out = await organizePages(await makePdf(1), [
      { index: 0, rotation: 0 },
      { index: 0, rotation: 90 },
    ]);
    expect(await pageRotations(out)).toEqual([0, 90]);
  });

  it('rejects an empty page list', async () => {
    await expect(organizePages(await makePdf(1), [])).rejects.toThrow(/no pages/);
  });
});

describe('loadPdf', () => {
  it('explains non-PDF input', async () => {
    await expect(loadPdf(new TextEncoder().encode('hello'))).rejects.toThrow(/could not be read as a PDF/);
  });
});

describe('normalizeAngle', () => {
  it('wraps to quarter turns', () => {
    expect([0, 90, -90, 360, 450, -180, 89].map(normalizeAngle)).toEqual([0, 90, 270, 0, 90, 180, 90]);
  });
});
