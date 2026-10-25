// Writes the PDF fixtures used by the browser tests into e2e/fixtures/.
// Images and the scanned PDF come from make-images.py (needs Pillow).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { degrees, FIXTURES, PDFDocument, rgb, StandardFonts } from './env.mjs';

mkdirSync(FIXTURES, { recursive: true });

async function makePdf(pageCount, label, { rotateSecond = false, form = false } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 40, y: 700, width: 515, height: 100, color: rgb(0.9, 0.3 + i * 0.05, 0.2) });
    page.drawText(`${label} page ${i + 1}`, { x: 60, y: 600, size: 36, font });
    for (let line = 0; line < 20; line++) {
      page.drawText(`Line ${line} of some body text for ${label}.`, { x: 60, y: 540 - line * 22, size: 14, font });
    }
    if (rotateSecond && i === 1) page.setRotation(degrees(90));
  }
  doc.setTitle(`${label} title`);
  doc.setAuthor('Fixture Author');
  if (form) {
    const field = doc.getForm().createTextField('name');
    field.setText('Filled value');
    field.addToPage(doc.getPage(0), { x: 60, y: 100, width: 200, height: 30 });
  }
  writeFileSync(`${FIXTURES}${label}.pdf`, await doc.save());
}

await makePdf(3, 'alpha');
await makePdf(5, 'bravo', { rotateSecond: true });
await makePdf(1, 'form', { form: true });
writeFileSync(`${FIXTURES}notapdf.pdf`, 'hello');

// Protected copies of bravo, made with MuPDF: one needs a password to open
// ("open sesame"), the other opens but forbids printing, copying and editing.
const mupdf = await import(new URL('../node_modules/mupdf/dist/mupdf.js', import.meta.url).href);
const bravo = mupdf.Document.openDocument(readFileSync(`${FIXTURES}bravo.pdf`), 'application/pdf').asPDF();
writeFileSync(`${FIXTURES}locked.pdf`, bravo.saveToBuffer('encrypt=aes-256,user-password=open sesame,owner-password=open sesame').asUint8Array());
// Text in a whole embedded font (Liberation Sans, from PDF.js), as many PDF makers leave it: Compact shrinks it.
const fonts = new mupdf.PDFDocument();
const font = fonts.addSimpleFont(new mupdf.Font('LiberationSans', readFileSync(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf', import.meta.url))));
for (const line of ['Embedded font page 1', 'Embedded font page 2']) {
  fonts.insertPage(-1, fonts.addPage([0, 0, 595, 842], 0, fonts.addObject({ Font: { F1: font } }), `BT /F1 24 Tf 60 700 Td (${line}) Tj ET`));
}
writeFileSync(`${FIXTURES}fonts.pdf`, fonts.saveToBuffer('compress').asUint8Array());
writeFileSync(`${FIXTURES}restricted.pdf`, bravo.saveToBuffer('encrypt=aes-128,owner-password=owner,permissions=-3904').asUint8Array());
console.log(`PDF fixtures written to ${FIXTURES}`);
