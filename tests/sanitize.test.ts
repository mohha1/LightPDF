import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { Composer, type ComposeOptions } from '../src/core/compose';
import { everything } from './fixtures';

const OPTIONS: ComposeOptions = { imageLayout: { pageSize: 'fit', orientation: 'auto', margin: 0 }, flatten: false };

/** A PDF carrying properties, XMP, an attachment, scripts, an orphaned object and a web link. */
async function leakyPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawText('Visible text', { x: 20, y: 100, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
  doc.setAuthor('AUTHOR-ALICE');
  doc.setCreator('CREATOR-APP');
  doc.setTitle('Old title');
  const xmp = doc.context.stream('<x:xmpmeta>XMP-HISTORY</x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
  await doc.attach(new TextEncoder().encode('ATTACHED-PAYLOAD'), 'notes.txt', { mimeType: 'text/plain' });
  doc.addJavaScript('hello', 'app.alert("SCRIPT-PAYLOAD")');
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({ S: 'JavaScript', JS: doc.context.obj('OPEN-PAYLOAD') }));
  // Not referenced from anywhere, like an old revision left by an incremental save.
  doc.context.register(doc.context.stream('ORPHAN-REVISION'));
  const link = doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [20, 20, 120, 40], A: { S: 'URI', URI: doc.context.obj('https://example.com/kept') } });
  page.node.addAnnot(doc.context.register(link));
  return doc.save({ useObjectStreams: false });
}

describe('Remove hidden data', () => {
  it('takes out properties, XMP, attachments, scripts and orphaned objects, but keeps links', async () => {
    const bytes = await leakyPdf();
    const before = await everything(bytes);
    for (const secret of ['AUTHOR-ALICE', 'CREATOR-APP', 'XMP-HISTORY', 'ATTACHED-PAYLOAD', 'SCRIPT-PAYLOAD', 'OPEN-PAYLOAD', 'ORPHAN-REVISION']) {
      expect(before).toContain(secret);
    }
    const composer = new Composer(new Map([['L', { kind: 'pdf', bytes }]]), { ...OPTIONS, removeHidden: true });
    const out = await composer.compose([{ source: 'L', index: 0, rotation: 0 }], 'x', { title: 'Kept title', author: '' });
    const after = await everything(out);
    for (const secret of ['AUTHOR-ALICE', 'CREATOR-APP', 'XMP-HISTORY', 'ATTACHED-PAYLOAD', 'SCRIPT-PAYLOAD', 'OPEN-PAYLOAD', 'ORPHAN-REVISION', 'Old title']) {
      expect(after).not.toContain(secret);
    }
    expect(after).toContain('https://example.com/kept');
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getTitle()).toBe('Kept title');
    expect(doc.getAuthor()).toBeUndefined();
  });

  it('leaves everything in place when not asked, apart from properties that were set', async () => {
    const bytes = await leakyPdf();
    const out = await new Composer(new Map([['L', { kind: 'pdf', bytes }]]), OPTIONS).compose([{ source: 'L', index: 0, rotation: 0 }], 'x', {
      author: 'Bob',
    });
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    expect(doc.getAuthor()).toBe('Bob');
    expect(doc.getTitle()).toBe('Old title');
    expect(await everything(out)).toContain('ATTACHED-PAYLOAD');
  });
});
