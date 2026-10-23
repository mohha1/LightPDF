import { degrees, rgb, StandardFonts, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { normalizeAngle } from './angle';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Maps a point given relative to the page as it is displayed (origin at the
 * displayed bottom-left corner) into the page's own coordinate space, taking
 * the page's /Rotate value into account.
 */
export function displayToUser(box: Box, rotation: number, dx: number, dy: number): { x: number; y: number } {
  switch (normalizeAngle(rotation)) {
    case 90:
      return { x: box.x + box.width - dy, y: box.y + dx };
    case 180:
      return { x: box.x + box.width - dx, y: box.y + box.height - dy };
    case 270:
      return { x: box.x + dy, y: box.y + box.height - dx };
    default:
      return { x: box.x + dx, y: box.y + dy };
  }
}

/** Width and height of the page as a viewer shows it. */
export function displaySize(page: PDFPage): { width: number; height: number } {
  const { width, height } = page.getCropBox();
  const sideways = normalizeAngle(page.getRotation().angle) % 180 !== 0;
  return sideways ? { width: height, height: width } : { width, height };
}

interface TextStyle {
  font: PDFFont;
  size: number;
  color: RGB;
  opacity?: number;
  /** Counter-clockwise angle of the text as displayed, in degrees. */
  rotate?: number;
}

/** Draws text with its baseline origin at a point in displayed-page coordinates. */
function drawDisplayText(page: PDFPage, text: string, dx: number, dy: number, style: TextStyle): void {
  const rotation = normalizeAngle(page.getRotation().angle);
  const point = displayToUser(page.getCropBox(), rotation, dx, dy);
  page.drawText(text, {
    x: point.x,
    y: point.y,
    font: style.font,
    size: style.size,
    color: style.color,
    opacity: style.opacity,
    rotate: degrees((style.rotate ?? 0) + rotation),
  });
}

export function hexToRgb(hex: string): RGB {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return rgb(0, 0, 0);
  const value = parseInt(match[1], 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function measure(font: PDFFont, text: string, size: number): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    throw new Error(
      `"${text}" contains characters the built-in fonts can't display. Use Latin letters, digits and common symbols.`,
    );
  }
}

export type Position = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface PageNumberOptions {
  position: Position;
  /** Distance from the page edge, in points. */
  margin: number;
  /** Number printed on the first numbered page. */
  startAt: number;
  /** Text to print; `{n}` is the page number and `{total}` the last number. */
  format: string;
  fontSize: number;
  color: string;
}

export function formatPageNumber(format: string, n: number, total: number): string {
  return format.replaceAll('{n}', String(n)).replaceAll('{total}', String(total));
}

/** Numbers every page of `doc`, as the pages are displayed. */
export async function stampPageNumbers(doc: PDFDocument, options: PageNumberOptions): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const color = hexToRgb(options.color);
  const pages = doc.getPages();
  const total = options.startAt + pages.length - 1;

  pages.forEach((page, position) => {
    const text = formatPageNumber(options.format, options.startAt + position, total);
    const textWidth = measure(font, text, options.fontSize);
    const capHeight = font.heightAtSize(options.fontSize, { descender: false });
    const { width, height } = displaySize(page);
    const [vertical, horizontal] = options.position.split('-');

    const x =
      horizontal === 'left'
        ? options.margin
        : horizontal === 'right'
          ? width - options.margin - textWidth
          : (width - textWidth) / 2;
    const y = vertical === 'top' ? height - options.margin - capHeight : options.margin;
    drawDisplayText(page, text, x, y, { font, size: options.fontSize, color });
  });
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  /** 0 (invisible) to 1 (solid). */
  opacity: number;
  /** Counter-clockwise angle, in degrees. */
  rotation: number;
  layout: 'center' | 'tile';
}

/** Stamps watermark text on every page of `doc`. */
export async function stampWatermark(doc: PDFDocument, options: WatermarkOptions): Promise<void> {
  const text = options.text.trim();
  if (!text) throw new Error('Type the text for your watermark.');

  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const size = options.fontSize;
  const style: TextStyle = {
    font,
    size,
    color: hexToRgb(options.color),
    opacity: options.opacity,
    rotate: options.rotation,
  };
  const textWidth = measure(font, text, size);
  const capHeight = font.heightAtSize(size, { descender: false });
  const angle = (options.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  // Places the text so that its visual centre lands on (cx, cy).
  const drawCentered = (page: PDFPage, cx: number, cy: number) => {
    const x = cx - (textWidth / 2) * cos + (capHeight / 2) * sin;
    const y = cy - (textWidth / 2) * sin - (capHeight / 2) * cos;
    drawDisplayText(page, text, x, y, style);
  };

  for (const page of doc.getPages()) {
    const { width, height } = displaySize(page);
    if (options.layout === 'center') {
      drawCentered(page, width / 2, height / 2);
      continue;
    }
    // Lay the tiles out in rows that follow the text's angle, staggering
    // alternate rows, then keep the ones that touch the page.
    const along = textWidth + size * 2;
    const across = size * 3.5;
    const reach = Math.hypot(width, height) / 2 + along;
    for (let row = -Math.ceil(reach / across); row * across <= reach; row++) {
      const offset = row % 2 === 0 ? 0 : along / 2;
      for (let column = -Math.ceil(reach / along) - 1; column * along <= reach; column++) {
        const u = column * along + offset;
        const v = row * across;
        const cx = width / 2 + u * cos - v * sin;
        const cy = height / 2 + u * sin + v * cos;
        if (cx > -textWidth && cx < width + textWidth && cy > -textWidth && cy < height + textWidth) {
          drawCentered(page, cx, cy);
        }
      }
    }
  }
}
