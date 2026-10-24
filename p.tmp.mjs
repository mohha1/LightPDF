import * as mupdf from 'mupdf';
import { PDFDocument, degrees } from 'pdf-lib';
// A "scan": 300x200 pt page fully covered by an image of yellowed paper with a dark ink block.
const W = 600, H = 400;
const pm = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, W, H], false);
const px = pm.getPixels();
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * pm.getStride() + x * 3;
  const ink = x > 200 && x < 320 && y > 180 && y < 210;
  px[i] = ink ? 30 : 235 - y / 20; px[i + 1] = ink ? 30 : 222 - y / 20; px[i + 2] = ink ? 30 : 180;
}
console.log('pixel written', pm.getPixels()[0], pm.getPixels()[1]);
const png = pm.asPNG();
for (const rot of [0, 90]) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: 300, height: 200 });
  page.node.addAnnot(doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Redact', Rect: [90, 85, 170, 115] })));
  if (rot) page.setRotation(degrees(rot));
  const m = mupdf.Document.openDocument(await doc.save(), 'application/pdf');
  const p = m.loadPage(0);
  const ctm = p.getTransform();
  console.log('rot', rot, 'ctm', JSON.stringify(ctm), 'bounds', JSON.stringify(p.getBounds()), 'annot rect', JSON.stringify(p.getAnnotations()[0].getRect()));
  console.log('Matrix api', Object.keys(mupdf.Matrix), 'Rect api', Object.keys(mupdf.Rect ?? {}));
}
