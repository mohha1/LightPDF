import {
  BlendMode,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  popGraphicsState,
  pushGraphicsState,
  setLineJoin,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import {
  arrowWings,
  cropOf,
  FONTS,
  LINE_HEIGHT,
  markBounds,
  overlaps,
  placedPoint,
  STAMP,
  SYMBOLS,
  symbolStrokes,
  textLines,
  type FontName,
  type Mark,
  type MarkImage,
  type Point,
  type Rect,
} from './marks';
import { displaySize, displayToUser, hexToRgb, measure, type Box } from './stamp';

/**
 * Where marks go on a PDF page: the rectangle in the page's own space that
 * the editor showed, the page's /Rotate, and how many points one unit of
 * mark coordinates is.
 */
export interface MarkFrame {
  box: Box;
  rotation: number;
  /** The shown page's height, in mark units. */
  height: number;
  scale: number;
}

/** The frame of a PDF page as the editor showed it: its crop box, with its own rotation. */
export function pageFrame(page: PDFPage): MarkFrame {
  return { box: page.getCropBox(), rotation: page.getRotation().angle, height: displaySize(page).height, scale: 1 };
}

/** A rectangle given in mark coordinates, in the page's own space. */
export function frameRect(frame: MarkFrame, rect: Rect): Rect {
  const a = displayToUser(frame.box, frame.rotation, rect.x * frame.scale, (frame.height - rect.y) * frame.scale);
  const b = displayToUser(frame.box, frame.rotation, (rect.x + rect.width) * frame.scale, (frame.height - rect.y - rect.height) * frame.scale);
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

/** Sets the page's visible area to the page editor's crop, if it has one. */
export function applyCrop(page: PDFPage, marks: readonly Mark[], frame: MarkFrame): void {
  const crop = cropOf(marks);
  if (!crop || crop.width <= 0 || crop.height <= 0) return;
  const { x, y, width, height } = frameRect(frame, crop);
  page.setCropBox(x, y, width, height);
}

/** Where a stamp's baseline sits below its middle, as a share of the font size (half of Helvetica Bold's capital height). */
export const STAMP_BASELINE = 0.36;

const PDF_FONTS: Record<FontName, [StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold],
};

/** Draws page-editor marks into the pages of one output document, embedding each font and image once. */
export class MarkPainter {
  private fonts = new Map<StandardFonts, Promise<PDFFont>>();
  private images = new Map<Uint8Array, Promise<PDFImage>>();

  constructor(private doc: PDFDocument) {}

  async paint(page: PDFPage, marks: readonly Mark[], frame: MarkFrame): Promise<void> {
    if (marks.length === 0) return;
    const toUser = (point: Point) =>
      displayToUser(frame.box, frame.rotation, point.x * frame.scale, (frame.height - point.y) * frame.scale);
    const userRect = (mark: Mark): Rect => frameRect(frame, markBounds(mark));
    const redactions = marks.filter((mark) => mark.type === 'redact').map(userRect);
    if (redactions.length) markForRedaction(page, redactions);
    const strokePath = (points: Point[][], color: string, lineWidth: number) => {
      // drawSvgPath flips y, so give it the page coordinates with y negated.
      const path = points
        .map((line) => line.map((point, i) => `${i ? 'L' : 'M'}${round(point.x)} ${round(-point.y)}`).join(' '))
        .join(' ');
      page.pushOperators(pushGraphicsState(), setLineJoin(LineJoinStyle.Round));
      page.drawSvgPath(path, {
        x: 0,
        y: 0,
        borderColor: hexToRgb(color),
        borderWidth: lineWidth * frame.scale,
        borderLineCap: LineCapStyle.Round,
      });
      page.pushOperators(popGraphicsState());
    };

    for (const mark of marks) {
      switch (mark.type) {
        case 'whiteout':
          page.drawRectangle({ ...userRect(mark), color: hexToRgb(mark.color) });
          break;
        case 'highlight':
          page.drawRectangle({ ...userRect(mark), color: hexToRgb(mark.color), blendMode: BlendMode.Multiply });
          break;
        case 'rect':
          page.drawRectangle(
            mark.filled
              ? { ...userRect(mark), color: hexToRgb(mark.color) }
              : { ...userRect(mark), borderColor: hexToRgb(mark.color), borderWidth: mark.lineWidth * frame.scale },
          );
          break;
        case 'ellipse': {
          const box = userRect(mark);
          const shape = { x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: box.width / 2, yScale: box.height / 2 };
          page.drawEllipse(
            mark.filled
              ? { ...shape, color: hexToRgb(mark.color) }
              : { ...shape, borderColor: hexToRgb(mark.color), borderWidth: mark.lineWidth * frame.scale },
          );
          break;
        }
        case 'line': {
          const lines = [[mark.from, mark.to]];
          if (mark.arrow) {
            const [left, right] = arrowWings(mark.from, mark.to, mark.lineWidth);
            lines.push([left, mark.to, right]);
          }
          strokePath(lines.map((line) => line.map(toUser)), mark.color, mark.lineWidth);
          break;
        }
        case 'ink':
          if (mark.points.length) strokePath([mark.points.map(toUser)], mark.color, mark.lineWidth);
          break;
        case 'text': {
          const font = await this.font(mark.font, mark.bold);
          const color = hexToRgb(mark.color);
          const rotate = degrees(frame.rotation - mark.angle);
          textLines(mark.text).forEach((line, i) => {
            if (!line.trim()) return;
            measure(font, line, mark.size);
            const origin = toUser(placedPoint(mark, 0, mark.size * (LINE_HEIGHT * i + FONTS[mark.font].baseline)));
            page.drawText(line, { ...origin, font, size: mark.size * frame.scale, color, rotate });
          });
          break;
        }
        case 'image': {
          const image = await this.image(mark.image);
          // pdf-lib turns an image around its bottom-left corner.
          const origin = toUser(placedPoint(mark, 0, mark.height));
          page.drawImage(image, {
            ...origin,
            width: mark.width * frame.scale,
            height: mark.height * frame.scale,
            rotate: degrees(frame.rotation - mark.angle),
          });
          break;
        }
        case 'stamp': {
          const font = await this.font('sans', true);
          const size = mark.height * STAMP.text;
          const width = measure(font, mark.text, size);
          const line = mark.height * STAMP.frame;
          const box = userRect(mark);
          const inset = (line * frame.scale) / 2;
          page.drawRectangle({
            x: box.x + inset,
            y: box.y + inset,
            width: box.width - 2 * inset,
            height: box.height - 2 * inset,
            borderColor: hexToRgb(mark.color),
            borderWidth: line * frame.scale,
          });
          const origin = toUser(placedPoint(mark, (mark.width - width) / 2, mark.height / 2 + size * STAMP_BASELINE));
          page.drawText(mark.text, { ...origin, font, size: size * frame.scale, color: hexToRgb(mark.color), rotate: degrees(frame.rotation - mark.angle) });
          break;
        }
        case 'symbol':
          if (mark.symbol === 'dot') {
            const box = userRect(mark);
            const radius = (Math.min(box.width, box.height) * 0.56) / 2;
            page.drawEllipse({ x: box.x + box.width / 2, y: box.y + box.height / 2, xScale: radius, yScale: radius, color: hexToRgb(mark.color) });
          } else {
            const strokes = symbolStrokes(mark).map((line) => line.map(toUser));
            strokePath(strokes, mark.color, Math.min(mark.width, mark.height) * SYMBOLS.lineWidth);
          }
          break;
        case 'redact':
        case 'crop':
          // Redaction happens after composing (core/redact.ts); cropping in compose.ts.
          break;
      }
    }
  }

  private font(name: FontName, bold: boolean): Promise<PDFFont> {
    const standard = PDF_FONTS[name][bold ? 1 : 0];
    let font = this.fonts.get(standard);
    if (!font) {
      font = this.doc.embedFont(standard);
      this.fonts.set(standard, font);
    }
    return font;
  }

  private image(image: MarkImage): Promise<PDFImage> {
    let embedded = this.images.get(image.bytes);
    if (!embedded) {
      embedded = image.kind === 'jpg' ? this.doc.embedJpg(image.bytes) : this.doc.embedPng(image.bytes);
      this.images.set(image.bytes, embedded);
    }
    return embedded;
  }
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Marks areas of a page for redaction as /Redact annotations, which
 * core/redact.ts applies. Anything else that sits on those areas and could
 * carry their content is removed now: annotations and form fields there (a
 * link's address, a field's value), and the page's embedded thumbnail.
 */
function markForRedaction(page: PDFPage, rects: Rect[]): void {
  const context = page.doc.context;
  const annots = page.node.Annots();
  if (annots) {
    for (let i = annots.size() - 1; i >= 0; i--) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const rect = annot?.lookupMaybe(PDFName.of('Rect'), PDFArray);
      if (!annot || !rect || rect.size() !== 4) continue;
      const [x1, y1, x2, y2] = rect.asArray().map((value) => (value instanceof PDFNumber ? value.asNumber() : Number(context.lookup(value, PDFNumber)?.asNumber())));
      const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      if (!rects.some((area) => overlaps(area, box))) continue;
      annots.remove(i);
      if (annot.get(PDFName.of('Subtype')) === PDFName.of('Widget')) clearField(annot);
    }
  }
  page.node.delete(PDFName.of('Thumb'));
  for (const { x, y, width, height } of rects) {
    const annot = context.obj({ Type: 'Annot', Subtype: 'Redact', Rect: [x, y, x + width, y + height], IC: [0, 0, 0] });
    page.node.addAnnot(context.register(annot));
  }
}

/**
 * A form field's value is kept in the field, not only in its widget on the
 * page, so taking the widget off the page isn't enough: clear the value and
 * the drawn appearance wherever they are stored.
 */
function clearField(widget: PDFDict): void {
  let field: PDFDict | undefined = widget;
  for (let depth = 0; field && !field.has(PDFName.of('T')) && depth < 32; depth++) {
    field = field.lookupMaybe(PDFName.of('Parent'), PDFDict);
  }
  for (const dict of new Set([widget, field ?? widget])) {
    for (const key of ['V', 'DV', 'RV', 'AP']) dict.delete(PDFName.of(key));
  }
}

