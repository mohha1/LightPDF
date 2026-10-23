import {
  arrowWings,
  FONTS,
  LINE_HEIGHT,
  markBounds,
  textLines,
  type Mark,
  type MarkImage,
  type PageView,
  type Point,
  type Size,
} from '../core/marks';

const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | undefined> = {},
  ...children: Array<SVGElement | string>
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) element.setAttribute(key, String(value));
  }
  element.append(...children);
  return element;
}

const blobUrls = new WeakMap<Uint8Array, string>();
const dataUrls = new WeakMap<Uint8Array, string>();

/** A URL for showing a mark's image on screen. */
function imageBlobUrl(image: MarkImage): string {
  let url = blobUrls.get(image.bytes);
  if (!url) {
    url = URL.createObjectURL(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.kind === 'jpg' ? 'image/jpeg' : 'image/png' }));
    blobUrls.set(image.bytes, url);
  }
  return url;
}

/** A data: URL, for images inside an SVG shown as an image (which can't load blob: URLs). */
function imageDataUrl(image: MarkImage): string {
  let url = dataUrls.get(image.bytes);
  if (!url) {
    let binary = '';
    for (let i = 0; i < image.bytes.length; i += 0x8000) binary += String.fromCharCode(...image.bytes.subarray(i, i + 0x8000));
    url = `data:image/${image.kind === 'jpg' ? 'jpeg' : 'png'};base64,${btoa(binary)}`;
    dataUrls.set(image.bytes, url);
  }
  return url;
}

const pathData = (lines: Point[][]) =>
  lines.map((line) => line.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')).join(' ');

function linePaths(mark: Extract<Mark, { type: 'line' | 'ink' }>): Point[][] {
  if (mark.type === 'ink') return [mark.points.length === 1 ? [mark.points[0], mark.points[0]] : [...mark.points]];
  const lines = [[mark.from, mark.to]];
  if (mark.arrow) {
    const [left, right] = arrowWings(mark.from, mark.to, mark.lineWidth);
    lines.push([left, mark.to, right]);
  }
  return lines;
}

/** One mark as SVG, in page coordinates. */
function markElement(mark: Mark, embed: boolean): SVGElement {
  switch (mark.type) {
    case 'whiteout':
      return svg('rect', { x: mark.x, y: mark.y, width: mark.width, height: mark.height, fill: mark.color });
    case 'highlight':
      return svg('rect', { x: mark.x, y: mark.y, width: mark.width, height: mark.height, fill: mark.color, style: 'mix-blend-mode:multiply' });
    case 'rect':
    case 'ellipse': {
      const paint = mark.filled
        ? { fill: mark.color }
        : { fill: 'none', stroke: mark.color, 'stroke-width': mark.lineWidth };
      return mark.type === 'rect'
        ? svg('rect', { x: mark.x, y: mark.y, width: mark.width, height: mark.height, ...paint })
        : svg('ellipse', { cx: mark.x + mark.width / 2, cy: mark.y + mark.height / 2, rx: mark.width / 2, ry: mark.height / 2, ...paint });
    }
    case 'line':
    case 'ink':
      return svg('path', {
        d: pathData(linePaths(mark)),
        fill: 'none',
        stroke: mark.color,
        'stroke-width': mark.lineWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
    case 'text': {
      const lines = textLines(mark.text).map((line, i) =>
        svg('tspan', { x: 0, y: mark.size * (LINE_HEIGHT * i + FONTS[mark.font].baseline) }, line),
      );
      return svg(
        'text',
        {
          transform: `translate(${mark.x} ${mark.y}) rotate(${mark.angle})`,
          'font-family': FONTS[mark.font].css,
          'font-size': mark.size,
          'font-weight': mark.bold ? 700 : 400,
          fill: mark.color,
          style: 'white-space:pre',
        },
        ...lines,
      );
    }
    case 'image':
      return svg('image', {
        href: embed ? imageDataUrl(mark.image) : imageBlobUrl(mark.image),
        width: mark.width,
        height: mark.height,
        preserveAspectRatio: 'none',
        transform: `translate(${mark.x} ${mark.y}) rotate(${mark.angle})`,
      });
  }
}

/**
 * The page editor's layer of marks, turned like the view. Each mark is a
 * group with a transparent area to grab it by; `hidden` is the mark whose
 * text is being typed in a text box above it.
 */
export function renderMarks(marks: readonly Mark[], view: PageView, grab: number, hidden?: string): SVGGElement {
  const groups = marks.map((mark) => {
    const shape = markElement(mark, false);
    if (mark.id === hidden) shape.setAttribute('visibility', 'hidden');
    const bounds = markBounds(mark);
    const area =
      mark.type === 'line' || mark.type === 'ink'
        ? svg('path', {
            d: pathData(linePaths(mark)),
            fill: 'none',
            stroke: 'transparent',
            'stroke-width': Math.max(mark.lineWidth, grab),
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
          })
        : svg('rect', { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, fill: 'transparent' });
    return svg('g', { class: 'pe-mark', 'data-id': mark.id }, shape, area);
  });
  return svg('g', { transform: `matrix(${view.matrix.join(' ')})` }, ...groups);
}

/**
 * A page thumbnail with its marks drawn over it, as an SVG data: URL. The
 * thumbnail keeps its pixel size, so it lays out like the plain one.
 */
export function markedThumbnail(thumbnail: string, thumbSize: Size, page: Size, marks: readonly Mark[]): string {
  const root = svg(
    'svg',
    { width: thumbSize.width, height: thumbSize.height, viewBox: `0 0 ${page.width} ${page.height}` },
    svg('image', { href: thumbnail, width: page.width, height: page.height, preserveAspectRatio: 'none' }),
    ...marks.map((mark) => markElement(mark, true)),
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}
