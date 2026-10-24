/**
 * Things added to a page in the page editor: text, shapes, freehand lines,
 * highlights, whiteout, images, stamps and ticks, plus a crop and boxes to
 * redact. They are stored with the page and only written into the PDF at
 * export, like every other edit.
 *
 * Coordinates are in points on the page as a viewer shows the original file
 * (its own /Rotate applied, none of the editor's extra rotation), with the
 * origin at the top-left corner and y pointing down. For an image page, the
 * page is the image itself, at 0.75 points per pixel.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type FontName = 'sans' | 'serif' | 'mono';

/**
 * A box that turns with its content. (`x`, `y`) is the content's own top-left
 * corner and `angle` how far the content is turned clockwise (0, 90, 180 or
 * 270), so text written on a turned page reads upright where it was typed.
 */
export interface Placed {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

export interface TextMark extends Placed {
  type: 'text';
  id: string;
  text: string;
  font: FontName;
  bold: boolean;
  /** Font size in points. */
  size: number;
  color: string;
}

export interface MarkImage {
  bytes: Uint8Array;
  kind: 'png' | 'jpg';
}

export interface ImageMark extends Placed {
  type: 'image';
  id: string;
  image: MarkImage;
}

/** A rectangle or ellipse: an outline, or filled with the colour. */
export interface ShapeMark extends Rect {
  type: 'rect' | 'ellipse';
  id: string;
  color: string;
  filled: boolean;
  lineWidth: number;
}

/**
 * A filled area. Whiteout covers what is under it (usually in white);
 * a highlight darkens like a marker (multiply), so text stays readable.
 */
export interface AreaMark extends Rect {
  type: 'whiteout' | 'highlight';
  id: string;
  color: string;
}

export interface LineMark {
  type: 'line';
  id: string;
  from: Point;
  to: Point;
  arrow: boolean;
  color: string;
  lineWidth: number;
}

export interface InkMark {
  type: 'ink';
  id: string;
  points: readonly Point[];
  color: string;
  lineWidth: number;
}

/** A rubber stamp: bold capitals in a frame, such as APPROVED or DRAFT. */
export interface StampMark extends Placed {
  type: 'stamp';
  id: string;
  text: string;
  color: string;
}

export type SymbolName = 'check' | 'cross' | 'dot';

/** A tick, a cross or a dot, for forms that are only printed lines and boxes. */
export interface SymbolMark extends Rect {
  type: 'symbol';
  id: string;
  symbol: SymbolName;
  color: string;
}

/**
 * Removes everything under the box at export (text, images, drawings,
 * annotations) and fills it black, or with `blank` leaves the page showing
 * through, as if nothing had been there. See core/redact.ts.
 */
export interface RedactMark extends Rect {
  type: 'redact';
  id: string;
  blank?: boolean;
}

/** The part of the page to keep; a page has at most one. */
export interface CropMark extends Rect {
  type: 'crop';
  id: string;
}

export type Mark = TextMark | ImageMark | ShapeMark | AreaMark | LineMark | InkMark | StampMark | SymbolMark | RedactMark | CropMark;

/** A value typed or chosen in one of the PDF's own form fields, by the field's full name. */
export type FieldValue = string | boolean | readonly string[];
export type FieldValues = Readonly<Record<string, FieldValue>>;

/** Stamp text as a share of the stamp's height, and its frame's line width. */
export const STAMP = { text: 0.55, frame: 0.07 };

/** The strokes of a tick or cross in a unit square (y down), and their width as a share of its size. */
export const SYMBOLS: Record<Exclude<SymbolName, 'dot'>, Point[][]> & { lineWidth: number } = {
  check: [[{ x: 0.12, y: 0.55 }, { x: 0.4, y: 0.82 }, { x: 0.9, y: 0.18 }]],
  cross: [
    [{ x: 0.15, y: 0.15 }, { x: 0.85, y: 0.85 }],
    [{ x: 0.85, y: 0.15 }, { x: 0.15, y: 0.85 }],
  ],
  lineWidth: 0.13,
};

/** A symbol's strokes on the page. */
export function symbolStrokes(mark: SymbolMark): Point[][] {
  if (mark.symbol === 'dot') return [];
  return SYMBOLS[mark.symbol].map((line) => line.map((p) => ({ x: mark.x + p.x * mark.width, y: mark.y + p.y * mark.height })));
}

/** The page's crop, if it has one. */
export function cropOf(marks: readonly Mark[] | undefined): CropMark | undefined {
  return marks?.findLast((mark): mark is CropMark => mark.type === 'crop');
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Space between lines of text, as a multiple of the font size. */
export const LINE_HEIGHT = 1.2;

/**
 * Per font: the CSS family used on screen, and where the first baseline sits
 * below the top of the text, as a multiple of the font size (close to where
 * CSS puts it with LINE_HEIGHT, so text doesn't jump when editing ends).
 */
export const FONTS: Record<FontName, { label: string; css: string; baseline: number }> = {
  sans: { label: 'Sans', css: 'Helvetica, Arial, "Liberation Sans", sans-serif', baseline: 0.94 },
  serif: { label: 'Serif', css: '"Times New Roman", Times, "Liberation Serif", serif', baseline: 0.93 },
  mono: { label: 'Mono', css: '"Courier New", Courier, "Liberation Mono", monospace', baseline: 0.87 },
};

/** Arrowhead length and half-width, as multiples of the line width (with a minimum in points). */
export function arrowHead(lineWidth: number): { length: number; spread: number } {
  const length = Math.max(8, lineWidth * 4);
  return { length, spread: length * 0.5 };
}

/** The two short strokes of an arrowhead pointing at `to`. */
export function arrowWings(from: Point, to: Point, lineWidth: number): [Point, Point] {
  const { length, spread } = arrowHead(lineWidth);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  const bx = to.x - ux * length;
  const by = to.y - uy * length;
  return [
    { x: bx - uy * spread, y: by + ux * spread },
    { x: bx + uy * spread, y: by - ux * spread },
  ];
}

export function textLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

// ------------------------------------------------------------------ geometry

export function quarterTurn(angle: number): number {
  return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
}

/** Turns a direction clockwise (y points down) by a quarter-turn angle. */
function turn(dx: number, dy: number, angle: number): Point {
  switch (quarterTurn(angle)) {
    case 90:
      return { x: -dy, y: dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: dy, y: -dx };
    default:
      return { x: dx, y: dy };
  }
}

/** The page-space point at (`u`, `v`) in a placed box's own coordinates. */
export function placedPoint(box: Placed, u: number, v: number): Point {
  const offset = turn(u, v, box.angle);
  return { x: box.x + offset.x, y: box.y + offset.y };
}

/** The upright rectangle a placed box covers. */
export function placedBounds(box: Placed): Rect {
  const a = placedPoint(box, 0, 0);
  const b = placedPoint(box, box.width, box.height);
  return normalizeRect(a, b);
}

/** Places a box of the given own size and angle so that it covers `bounds`. */
export function placeIn(bounds: Rect, angle: number): Placed {
  const turned = quarterTurn(angle);
  const sideways = turned % 180 !== 0;
  const width = sideways ? bounds.height : bounds.width;
  const height = sideways ? bounds.width : bounds.height;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const corner =
    turned === 90 ? { x: right, y: bounds.y } : turned === 180 ? { x: right, y: bottom } : turned === 270 ? { x: bounds.x, y: bottom } : { x: bounds.x, y: bounds.y };
  return { ...corner, width, height, angle: turned };
}

export function normalizeRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** The upright rectangle a mark covers, on the page. */
export function markBounds(mark: Mark): Rect {
  switch (mark.type) {
    case 'text':
    case 'image':
    case 'stamp':
      return placedBounds(mark);
    case 'line':
      return normalizeRect(mark.from, mark.to);
    case 'ink':
      return boundsOfPoints(mark.points);
    default:
      return { x: mark.x, y: mark.y, width: mark.width, height: mark.height };
  }
}

export function moveMark<M extends Mark>(mark: M, dx: number, dy: number): M {
  const shift = (point: Point) => ({ x: point.x + dx, y: point.y + dy });
  switch (mark.type) {
    case 'line':
      return { ...mark, from: shift(mark.from), to: shift(mark.to) };
    case 'ink':
      return { ...mark, points: mark.points.map(shift) };
    default:
      return { ...mark, x: mark.x + dx, y: mark.y + dy };
  }
}

/**
 * Stretches a mark from the rectangle it covers to `next`. Text scales its
 * font size with the height, so callers keep text in proportion.
 */
export function resizeMark<M extends Mark>(mark: M, next: Rect): M {
  const old = markBounds(mark);
  const sx = old.width > 0 ? next.width / old.width : 1;
  const sy = old.height > 0 ? next.height / old.height : 1;
  const map = (point: Point) => ({ x: next.x + (point.x - old.x) * sx, y: next.y + (point.y - old.y) * sy });
  switch (mark.type) {
    case 'line':
      return { ...mark, from: map(mark.from), to: map(mark.to) };
    case 'ink':
      return { ...mark, points: mark.points.map(map) };
    case 'image':
    case 'stamp':
      return { ...mark, ...placeIn(next, mark.angle) };
    case 'text': {
      const scale = quarterTurn(mark.angle) % 180 === 0 ? sy : sx;
      return { ...mark, ...placeIn(next, mark.angle), size: Math.max(1, mark.size * scale) };
    }
    default:
      return { ...mark, ...next };
  }
}

// ------------------------------------------------------------------ views

/**
 * Maps between the page and a view of it turned clockwise by `rotation`
 * (the editor's extra rotation). `size` is the page's own size.
 */
export class PageView {
  readonly rotation: number;

  constructor(
    readonly size: Size,
    rotation: number,
  ) {
    this.rotation = quarterTurn(rotation);
  }

  /** Width and height of the turned page. */
  get viewSize(): Size {
    return this.rotation % 180 === 0 ? this.size : { width: this.size.height, height: this.size.width };
  }

  toView({ x, y }: Point): Point {
    const { width, height } = this.size;
    switch (this.rotation) {
      case 90:
        return { x: height - y, y: x };
      case 180:
        return { x: width - x, y: height - y };
      case 270:
        return { x: y, y: width - x };
      default:
        return { x, y };
    }
  }

  fromView({ x, y }: Point): Point {
    const { width, height } = this.size;
    switch (this.rotation) {
      case 90:
        return { x: y, y: height - x };
      case 180:
        return { x: width - x, y: height - y };
      case 270:
        return { x: width - y, y: x };
      default:
        return { x, y };
    }
  }

  rectToView(rect: Rect): Rect {
    return normalizeRect(this.toView(rect), this.toView({ x: rect.x + rect.width, y: rect.y + rect.height }));
  }

  rectFromView(rect: Rect): Rect {
    return normalizeRect(this.fromView(rect), this.fromView({ x: rect.x + rect.width, y: rect.y + rect.height }));
  }

  /** An SVG/canvas transform matrix [a, b, c, d, e, f] from page to view. */
  get matrix(): [number, number, number, number, number, number] {
    const { width, height } = this.size;
    switch (this.rotation) {
      case 90:
        return [0, 1, -1, 0, height, 0];
      case 180:
        return [-1, 0, 0, -1, width, height];
      case 270:
        return [0, -1, 1, 0, 0, width];
      default:
        return [1, 0, 0, 1, 0, 0];
    }
  }
}
