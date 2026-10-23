import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { flattenForms, optimizeLossless, readMetadata, writeMetadata } from '../src/core/document';
import { makePdf, pageWidths } from './fixtures';

describe('metadata', () => {
  it('round-trips all fields', async () => {
    const metadata = {
      title: 'Annual report',
      author: 'Ada',
      subject: 'Finance',
      keywords: 'one, two',
      creator: 'Writer',
      producer: 'Press',
    };
    const out = await writeMetadata(await makePdf(1), metadata);
    expect(await readMetadata(out)).toEqual({ ...metadata, keywords: 'one two' });
  });
});

describe('flattenForms', () => {
  it('removes form fields and reports how many there were', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 300]);
    const field = doc.getForm().createTextField('name');
    field.setText('Ada');
    field.addToPage(page, { x: 10, y: 10, width: 200, height: 30 });
    const { bytes, fieldCount } = await flattenForms(await doc.save());
    expect(fieldCount).toBe(1);
    expect((await PDFDocument.load(bytes)).getForm().getFields()).toHaveLength(0);
  });

  it('leaves PDFs without forms alone', async () => {
    const { fieldCount } = await flattenForms(await makePdf(1));
    expect(fieldCount).toBe(0);
  });
});

describe('optimizeLossless', () => {
  it('keeps every page', async () => {
    expect(await pageWidths(await optimizeLossless(await makePdf(3)))).toEqual([100, 101, 102]);
  });
});
