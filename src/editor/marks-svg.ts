import {
  arrowWings,
  cropOf,
  FONTS,
  LINE_HEIGHT,
  markBounds,
  STAMP,
  SYMBOLS,
  symbolStrokes,
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

/** Where a stamp's baseline sits below its middle, as a share of the font size (as in core/annotate.ts). */
const STAMP_BASELINE = 0.36;

/**
 * One mark as SVG, in page coordinates. `final` draws it as it will look in
 * the file (for thumbnails); otherwise as the editor shows it, with a crop
 * shading the rest of the page and redactions see-through.
 */
function markElement(mark: Mark, final: boolean, page: Size): SVGElement {
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
        href: final ? imageDataUrl(mark.image) : imageBlobUrl(mark.image),
        width: mark.width,
        height: mark.height,
        preserveAspectRatio: 'none',
        transform: `translate(${mark.x} ${mark.y}) rotate(${mark.angle})`,
      });
    case 'stamp': {
      const line = mark.height * STAMP.frame;
      const size = mark.height * STAMP.text;
      return svg(
        'g',
        { transform: `translate(${mark.x} ${mark.y}) rotate(${mark.angle})`, fill: 'none', stroke: mark.color },
        svg('rect', { x: line / 2, y: line / 2, width: mark.width - line, height: mark.height - line, 'stroke-width': line }),
        svg(
          'text',
          {
            x: mark.width / 2,
            y: mark.height / 2 + size * STAMP_BASELINE,
            'text-anchor': 'middle',
            'font-family': FONTS.sans.css,
            'font-weight': 700,
            'font-size': size,
            fill: mark.color,
            stroke: 'none',
            style: 'white-space:pre',
          },
          mark.text,
        ),
      );
    }
    case 'symbol': {
      if (mark.symbol === 'dot') {
        const radius = (Math.min(mark.width, mark.height) * 0.56) / 2;
        return svg('circle', { cx: mark.x + mark.width / 2, cy: mark.y + mark.height / 2, r: radius, fill: mark.color });
      }
      return svg('path', {
        d: pathData(symbolStrokes(mark)),
        fill: 'none',
        stroke: mark.color,
        'stroke-width': Math.min(mark.width, mark.height) * SYMBOLS.lineWidth,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      });
    }
    case 'redact': {
      const box = { x: mark.x, y: mark.y, width: mark.width, height: mark.height };
      // In thumbnails a blank one shows white: the page usually is, and what was there is gone.
      if (final) return svg('rect', { ...box, fill: mark.blank ? '#fff' : '#000' });
      return svg('rect', { ...box, class: mark.blank ? 'pe-redact pe-redact-blank' : 'pe-redact' });
    }
    case 'crop': {
      if (final) return svg('g');
      // Shade everything outside the crop.
      const outside = `M0 0H${page.width}V${page.height}H0Z M${mark.x} ${mark.y}V${mark.y + mark.height}H${mark.x + mark.width}V${mark.y}Z`;
      return svg(
        'g',
        { class: 'pe-crop' },
        svg('path', { d: outside, 'fill-rule': 'evenodd', class: 'pe-crop-shade' }),
        svg('rect', { x: mark.x, y: mark.y, width: mark.width, height: mark.height, class: 'pe-crop-edge' }),
      );
    }
  }
}

/**
 * The page editor's layer of marks, turned like the view. Each mark is a
 * group with a transparent area to grab it by; `hidden` is the mark whose
 * text is being typed in a text box above it.
 */
export function renderMarks(marks: readonly Mark[], view: PageView, grab: number, hidden?: string): SVGGElement {
  // The crop goes underneath, so what is drawn inside it can still be picked.
  const ordered = [...marks.filter((mark) => mark.type === 'crop'), ...marks.filter((mark) => mark.type !== 'crop')];
  const groups = ordered.map((mark) => {
    const shape = markElement(mark, false, view.size);
    if (mark.id === hidden) shape.setAttribute('visibility', 'hidden');
    const bounds = markBounds(mark);
    const area =
      mark.type === 'crop'
        ? svg('rect', { ...bounds, fill: 'none', stroke: 'transparent', 'stroke-width': grab })
        : mark.type === 'line' || mark.type === 'ink'
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
 * A page thumbnail with its marks drawn over it, as an SVG data: URL, cut to
 * the crop if there is one. Its long side is `pixels` long, so it lays out
 * like a plain thumbnail.
 */
export function markedThumbnail(thumbnail: string, page: Size, marks: readonly Mark[], pixels: number): string {
  const area = cropOf(marks) ?? { x: 0, y: 0, ...page };
  const shrink = pixels / Math.max(area.width, area.height);
  const root = svg(
    'svg',
    {
      width: Math.max(1, Math.round(area.width * shrink)),
      height: Math.max(1, Math.round(area.height * shrink)),
      viewBox: `${area.x} ${area.y} ${area.width} ${area.height}`,
    },
    svg('image', { href: thumbnail, width: page.width, height: page.height, preserveAspectRatio: 'none' }),
    ...marks.map((mark) => markElement(mark, true, page)),
  );
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
}
