import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { Composer, type ComposeOptions, type ComposeSource } from '../src/core/compose';
import { everything, makePdf } from './fixtures';

const OPTIONS: ComposeOptions = { imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 }, flatten: false };

async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 300]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 20, y: 240, width: 200, height: 24 });
  form.createCheckBox('agree').addToPage(page, { x: 20, y: 200, width: 16, height: 16 });
  const size = form.createRadioGroup('size');
  size.addOptionToPage('small', page, { x: 20, y: 160, width: 14, height: 14 });
  size.addOptionToPage('large', page, { x: 60, y: 160, width: 14, height: 14 });
  const colour = form.createDropdown('colour');
  colour.addOptions(['Red', 'Blue']);
  colour.addToPage(page, { x: 20, y: 120, width: 100, height: 20 });
  return doc.save();
}

const values = { name: 'Ada Lovelace', agree: true, size: 'large', colour: 'Blue' };

describe('filling in forms', () => {
  it('fills the fields of an untouched PDF, which stay fillable', async () => {
    const sources = new Map<string, ComposeSource>([['F', { kind: 'pdf', bytes: await formPdf() }]]);
    const out = await new Composer(sources, OPTIONS).compose([{ source: 'F', index: 0, rotation: 0, fields: values }], 'x');
    const form = (await PDFDocument.load(out)).getForm();
    expect(form.getTextField('name').getText()).toBe('Ada Lovelace');
    expect(form.getCheckBox('agree').isChecked()).toBe(true);
    expect(form.getRadioGroup('size').getSelected()).toBe('large');
    expect(form.getDropdown('colour').getSelected()).toEqual(['Blue']);
  });

  it('draws the values into pages copied into a new document, and flattens them when asked', async () => {
    const sources = new Map<string, ComposeSource>([
      ['F', { kind: 'pdf', bytes: await formPdf() }],
      ['B', { kind: 'pdf', bytes: await makePdf(1) }],
    ]);
    const pages = [
      { source: 'B', index: 0, rotation: 0 },
      { source: 'F', index: 0, rotation: 0, fields: values },
    ];
    expect(await everything(await new Composer(sources, OPTIONS).compose(pages, 'x'))).toContain('Ada Lovelace');
    const flat = await new Composer(sources, { ...OPTIONS, flatten: true }).compose(pages, 'x');
    expect(await everything(flat)).toContain('Ada Lovelace');
    expect((await PDFDocument.load(flat)).getForm().getFields()).toHaveLength(0);
  });

  it('keeps the values of different copies of the same form apart', async () => {
    const sources = new Map<string, ComposeSource>([['F', { kind: 'pdf', bytes: await formPdf() }]]);
    const composer = new Composer(sources, OPTIONS);
    const one = await composer.compose([{ source: 'F', index: 0, rotation: 0, fields: { name: 'First copy' } }, { source: 'F', index: 0, rotation: 90 }], 'a');
    const two = await composer.compose([{ source: 'F', index: 0, rotation: 0, fields: { name: 'Second copy' } }, { source: 'F', index: 0, rotation: 90 }], 'b');
    expect(await everything(one)).not.toContain('Second copy');
    expect(await everything(two)).not.toContain('First copy');
  });

  it('explains values the built-in fonts cannot write', async () => {
    const sources = new Map<string, ComposeSource>([['F', { kind: 'pdf', bytes: await formPdf() }]]);
    await expect(new Composer(sources, OPTIONS).compose([{ source: 'F', index: 0, rotation: 0, fields: { name: 'Привет' } }], 'x')).rejects.toThrow(
      /Latin letters/,
    );
  });
});
