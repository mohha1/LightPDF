import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { Composer, type ComposeOptions, type ComposeSource } from '../src/core/compose';
import { fromBase64, JPEG_BASE64, makePdf, PNG_BASE64 } from './fixtures';

const OPTIONS: ComposeOptions = {
  imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 },
  flatten: false,
};

async function sources(): Promise<Map<string, ComposeSource>> {
  return new Map<string, ComposeSource>([
    ['A', { kind: 'pdf', bytes: await makePdf(3, { title: 'Alpha', rotations: [0, 90, 0] }) }],
    ['B', { kind: 'pdf', bytes: await makePdf(2) }],
    ['J', { kind: 'image', image: { bytes: fromBase64(JPEG_BASE64), kind: 'jpg' } }],
    ['P', { kind: 'image', image: { bytes: fromBase64(PNG_BASE64), kind: 'png' } }],
  ]);
}

async function describePdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return {
    title: doc.getTitle(),
    pages: doc.getPages().map((page) => `${Math.round(page.getWidth())}x${Math.round(page.getHeight())}@${page.getRotation().angle}`),
  };
}

describe('Composer', () => {
  it('mixes pages from several PDFs and images, adding rotation', async () => {
    const composer = new Composer(await sources(), OPTIONS);
    const out = await composer.compose(
      [
        { source: 'B', index: 1, rotation: 0 },
        { source: 'A', index: 1, rotation: 90 },
        { source: 'J', index: 0, rotation: 270 },
        { source: 'A', index: 0, rotation: 0 },
        { source: 'P', index: 0, rotation: 0 },
        { source: 'J', index: 0, rotation: 0 },
      ],
      'Mixed',
    );
    expect(await describePdf(out)).toEqual({
      title: 'Mixed',
      pages: ['101x200@0', '101x200@180', '3x2@270', '100x200@0', '2x4@0', '3x2@0'],
    });
  });

  it('edits the original PDF when its pages are untouched, keeping its metadata', async () => {
    const composer = new Composer(await sources(), OPTIONS);
    const out = await composer.compose(
      [
        { source: 'A', index: 0, rotation: 90 },
        { source: 'A', index: 1, rotation: 0 },
        { source: 'A', index: 2, rotation: 0 },
      ],
      'Ignored',
    );
    expect(await describePdf(out)).toEqual({ title: 'Alpha', pages: ['100x200@90', '101x200@90', '102x200@0'] });
  });

  it('stamps page numbers and watermarks on every page', async () => {
    const plain = await new Composer(await sources(), OPTIONS).compose([{ source: 'B', index: 0, rotation: 0 }], 'x');
    const stamped = await new Composer(await sources(), {
      ...OPTIONS,
      pageNumbers: { position: 'bottom-center', margin: 20, startAt: 1, format: '{n}', fontSize: 10, color: '#000000' },
      watermark: { text: 'DRAFT', fontSize: 30, color: '#ff0000', opacity: 0.3, rotation: 45, layout: 'tile' },
    }).compose([{ source: 'B', index: 0, rotation: 0 }], 'x');
    expect(stamped.length).toBeGreaterThan(plain.length + 200);
  });

  it('flattens forms in sources before copying their pages', async () => {
    const form = await PDFDocument.create();
    const page = form.addPage([300, 300]);
    const field = form.getForm().createTextField('name');
    field.setText('Ada');
    field.addToPage(page, { x: 10, y: 10, width: 200, height: 30 });
    const map = new Map<string, ComposeSource>([['F', { kind: 'pdf', bytes: await form.save() }], ...(await sources())]);
    const composer = new Composer(map, { ...OPTIONS, flatten: true });

    const passThrough = await PDFDocument.load(await composer.compose([{ source: 'F', index: 0, rotation: 0 }], 'f'));
    expect(passThrough.getForm().getFields()).toHaveLength(0);
    expect(passThrough.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
    const copied = await PDFDocument.load(
      await composer.compose([{ source: 'F', index: 0, rotation: 0 }, { source: 'B', index: 0, rotation: 0 }], 'f'),
    );
    expect(copied.getPage(0).node.Annots()?.size() ?? 0).toBe(0);
  });

  it('rejects empty documents and unknown sources', async () => {
    const composer = new Composer(await sources(), OPTIONS);
    await expect(composer.compose([], 'x')).rejects.toThrow(/no pages/);
    await expect(composer.compose([{ source: 'Z', index: 0, rotation: 0 }], 'x')).rejects.toThrow(/missing/);
  });
});
