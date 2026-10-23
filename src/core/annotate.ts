import {
  BlendMode,
  degrees,
  LineCapStyle,
  LineJoinStyle,
  popGraphicsState,
  pushGraphicsState,
  setLineJoin,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { arrowWings, FONTS, LINE_HEIGHT, markBounds, placedPoint, textLines, type FontName, type Mark, type MarkImage, type Point } from './marks';
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
    const userRect = (mark: Mark) => {
      const bounds = markBounds(mark);
      const a = toUser(bounds);
      const b = toUser({ x: bounds.x + bounds.width, y: bounds.y + bounds.height });
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
    };
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
