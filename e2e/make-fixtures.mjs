// Writes the PDF fixtures used by the browser tests into e2e/fixtures/.
// Images and the scanned PDF come from make-images.py (needs Pillow).
import { mkdirSync, writeFileSync } from 'node:fs';
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
console.log(`PDF fixtures written to ${FIXTURES}`);
