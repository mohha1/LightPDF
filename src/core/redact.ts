import type * as MuPDF from 'mupdf';
import { paperPatch, type PixelBox, type Raster } from './paper';

export type MuPDFLibrary = typeof MuPDF;

type Box = [number, number, number, number];

const intersects = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Applies the /Redact annotations that MarkPainter put on the pages, with
 * MuPDF: text, image pixels and drawings under each box are removed from the
 * file (not covered). A box with a fill colour is filled black; one without
 * is left blank, so the page shows through as if nothing had been there.
 * Where a blank box was over a picture, such as a scan, the removed pixels
 * would turn white, so the area is painted with paper made from the pixels
 * around it (core/paper.ts).
 *
 * It fails closed: if any character is still found under a box afterwards,
 * it throws rather than hand back a file that only looks redacted. Saving
 * with garbage collection drops the objects the removed content lived in.
 */
export function applyRedactions(mupdf: MuPDFLibrary, bytes: Uint8Array): Uint8Array {
  const opened = mupdf.Document.openDocument(bytes, 'application/pdf');
  try {
    const pdf = opened.asPDF();
    if (!pdf) throw new Error('This document could not be redacted.');
    let redacted = 0;
    for (let index = 0; index < pdf.countPages(); index++) {
      const page = pdf.loadPage(index) as MuPDF.PDFPage;
      const annotations = page.getAnnotations().filter((annotation) => annotation.getType() === 'Redact');
      const boxes = annotations.map((annotation) => annotation.getRect() as Box);
      if (boxes.length === 0) continue;
      const apply = (target: MuPDF.PDFPage, blackBoxes: boolean) =>
        target.applyRedactions(
          blackBoxes,
          mupdf.PDFPage.REDACT_IMAGE_PIXELS,
          mupdf.PDFPage.REDACT_LINE_ART_REMOVE_IF_COVERED,
          mupdf.PDFPage.REDACT_TEXT_REMOVE,
        );
      // One call treats every box on the page alike, so the blank ones are
      // set aside while the black ones are applied, then put back and applied.
      // hasInteriorColor() is always false for Redact annotations, so read the entry itself.
      const blank = annotations.filter((annotation) => !annotation.getObject().get('IC').isArray());
      const blankBoxes = blank.map((annotation) => annotation.getRect() as Box);
      // What surrounds the blank boxes, before anything is removed.
      const before = blankBoxes.length ? render(mupdf, page) : undefined;
      for (const annotation of blank) page.deleteAnnotation(annotation);
      if (blank.length < annotations.length) apply(page, true);
      if (before) {
        const again = pdf.loadPage(index) as MuPDF.PDFPage;
        for (const rect of blankBoxes) again.createAnnotation('Redact').setRect(rect);
        apply(again, false);
        const cleared = pdf.loadPage(index) as MuPDF.PDFPage;
        const after = render(mupdf, cleared);
        for (const [i, rect] of blankBoxes.entries()) {
          // MuPDF blanks every picture pixel the box touches, a sliver past its edges too: cover all that changed.
          const box = changed(before.raster, after.raster, before.box(rect));
          if (box.width < 1 || box.height < 1) continue;
          const patch = paperPatch(before.raster, box, index * 7919 + i + 1);
          // Where the page already shows its own background (a white or drawn page), leave it.
          if (difference(after.raster, box, patch) > 6) drawPatch(mupdf, pdf, cleared, before.rect(box), patch, box);
        }
      }
      // Check a freshly loaded page: what is in the file now.
      const after = pdf.loadPage(index) as MuPDF.PDFPage;
      let left = '';
      after.toStructuredText('preserve-whitespace').walk({
        onChar(char, _origin, _font, _size, quad) {
          const xs = [quad[0], quad[2], quad[4], quad[6]];
          const ys = [quad[1], quad[3], quad[5], quad[7]];
          const box: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          if (char.trim() && boxes.some((area) => intersects(box, area))) left += char;
        },
      });
      if (left) throw new Error(`Redaction failed on page ${index + 1}: some text under a box could not be removed, so nothing was saved.`);
      if (after.getAnnotations().some((annotation) => annotation.getType() === 'Redact')) {
        throw new Error(`Redaction failed on page ${index + 1}, so nothing was saved.`);
      }
      redacted += boxes.length;
    }
    if (redacted === 0) return bytes;
    // garbage=4 drops unused objects (the old content) and merges duplicates; clean rewrites content streams.
    return pdf.saveToBuffer('garbage=4,compress,clean').asUint8Array().slice();
  } finally {
    opened.destroy();
  }
}

/** Pixels per point for working out paper, and the largest page side in pixels. */
const RENDER = { scale: 2, maxSide: 4000 };

/** A page drawn without its annotations, and where a rectangle on it falls in pixels and back. */
function render(mupdf: MuPDFLibrary, page: MuPDF.PDFPage): { raster: Raster; box(rect: Box): PixelBox; rect(box: PixelBox): Box } {
  const [x0, y0, x1, y1] = page.getBounds();
  const scale = Math.min(RENDER.scale, RENDER.maxSide / Math.max(x1 - x0, y1 - y0));
  const pixmap = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, false);
  const left = pixmap.getX();
  const top = pixmap.getY();
  // A copy: the pixmap's pixels live in MuPDF's memory, which can move.
  const raster = {
    pixels: pixmap.getPixels().slice(),
    width: pixmap.getWidth(),
    height: pixmap.getHeight(),
    stride: pixmap.getStride(),
    channels: pixmap.getNumberOfComponents(),
  };
  pixmap.destroy();
  return {
    raster,
    box([rx0, ry0, rx1, ry1]) {
      const x = Math.max(0, Math.floor(rx0 * scale - left));
      const y = Math.max(0, Math.floor(ry0 * scale - top));
      const width = Math.min(raster.width, Math.ceil(rx1 * scale - left)) - x;
      const height = Math.min(raster.height, Math.ceil(ry1 * scale - top)) - y;
      return { x, y, width, height };
    },
    rect({ x, y, width, height }) {
      return [(x + left) / scale, (y + top) / scale, (x + width + left) / scale, (y + height + top) / scale];
    },
  };
}

/** `box` grown to take in every pixel near it that redacting changed. */
function changed(before: Raster, after: Raster, box: PixelBox): PixelBox {
  const reach = 6;
  let [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height];
  for (let y = Math.max(0, box.y - reach); y < Math.min(before.height, box.y + box.height + reach); y++) {
    for (let x = Math.max(0, box.x - reach); x < Math.min(before.width, box.x + box.width + reach); x++) {
      const i = y * before.stride + x * before.channels;
      const shift = Math.max(...[0, 1, 2].map((c) => Math.abs(before.pixels[i + c] - after.pixels[i + c])));
      // Renders are exact, so any change at all is the redaction (edge pixels only partly).
      if (shift <= 2) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The average difference per channel between an area of a raster and a patch made for it. */
function difference(raster: Raster, box: PixelBox, patch: Uint8Array): number {
  let total = 0;
  let count = 0;
  const width = Math.min(box.width, patch.length / 3 / Math.max(1, box.height));
  for (let y = 0; y < box.height && box.y + y < raster.height; y++) {
    for (let x = 0; x < width && box.x + x < raster.width; x++) {
      const i = (box.y + y) * raster.stride + (box.x + x) * raster.channels;
      for (let channel = 0; channel < 3; channel++) total += Math.abs(raster.pixels[i + channel] - patch[(y * box.width + x) * 3 + channel]);
      count += 3;
    }
  }
  return count ? total / count : 0;
}

let patches = 0;

/** Paints a patch of paper over `rect` (page coordinates as MuPDF gives them, y down), as an image on top of the page. */
function drawPatch(mupdf: MuPDFLibrary, pdf: MuPDF.PDFDocument, page: MuPDF.PDFPage, rect: Box, patch: Uint8Array, box: PixelBox): void {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, box.width, box.height], false);
  const stride = pixmap.getStride();
  const pixels = pixmap.getPixels();
  for (let y = 0; y < box.height; y++) pixels.set(patch.subarray(y * box.width * 3, (y + 1) * box.width * 3), y * stride);
  const image = pdf.addImage(new mupdf.Image(pixmap));
  pixmap.destroy();

  const node = page.getObject();
  let resources = node.getInheritable('Resources');
  if (resources.isNull()) resources = pdf.newDictionary();
  node.put('Resources', resources);
  let xobjects = resources.get('XObject');
  if (xobjects.isNull()) {
    xobjects = pdf.newDictionary();
    resources.put('XObject', xobjects);
  }
  let name: string;
  do name = `LightPDFPaper${++patches}`;
  while (!xobjects.get(name).isNull());
  xobjects.put(name, image);

  // The image's unit square onto the rectangle (its first row at the top), then into the page's own space.
  const [x0, y0, x1, y1] = rect;
  const placed = mupdf.Matrix.concat([x1 - x0, 0, 0, -(y1 - y0), x0, y1], mupdf.Matrix.invert(page.getTransform()));
  const matrix = placed.map((value) => Number(value.toFixed(5))).join(' ');
  // Wrap the page's content in q/Q so whatever it leaves in the graphics state can't move the patch.
  const contents = node.get('Contents');
  const list = pdf.newArray();
  list.push(pdf.addStream('q\n', pdf.newDictionary()));
  if (contents.isArray()) contents.forEach((stream) => list.push(stream));
  else if (!contents.isNull()) list.push(contents);
  list.push(pdf.addStream(`Q\nq ${matrix} cm /${name} Do Q\n`, pdf.newDictionary()));
  node.put('Contents', list);
}
