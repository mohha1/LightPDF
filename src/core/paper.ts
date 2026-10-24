/**
 * Makes a patch of "paper" for an area whose content was removed, from the
 * pixels around it, so a redaction left blank on a scan or a tinted page
 * looks like the paper rather than a white hole. Only pixels outside the
 * area are read, so nothing that was removed can come back.
 */

/** RGB pixels, row by row; `stride` is the bytes per row. */
export interface Raster {
  pixels: ArrayLike<number>;
  width: number;
  height: number;
  stride: number;
  channels: number;
}

/** A rectangle of whole pixels in a raster. */
export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Colour = [number, number, number];

const luminance = ([r, g, b]: Colour) => 0.299 * r + 0.587 * g + 0.114 * b;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianColour(colours: Colour[]): Colour {
  return [0, 1, 2].map((channel) => median(colours.map((colour) => colour[channel]))) as Colour;
}

/** A small, seeded random number generator, so the same input gives the same patch. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far a sample may be from the paper's colour before it counts as ink. */
const INK = 45;

/**
 * Paper for `box`, as RGB rows: the colours along each side are taken from
 * a band of pixels just outside it (ink in that band is ignored), blended
 * smoothly across the box so stains and shading carry on, and given the
 * paper's own grain.
 */
export function paperPatch(raster: Raster, box: PixelBox, seed = 1): Uint8Array {
  const { width, height } = box;
  const depth = Math.max(3, Math.min(12, Math.round(Math.min(width, height) * 0.25)));
  const gap = 1;
  const at = (x: number, y: number): Colour | undefined => {
    if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) return undefined;
    const i = y * raster.stride + x * raster.channels;
    return [raster.pixels[i], raster.pixels[i + 1], raster.pixels[i + 2]];
  };

  // The colour of a band, one sample per pixel along a side.
  const band = (length: number, sample: (along: number, out: number) => Colour | undefined): Array<Colour | undefined> =>
    Array.from({ length }, (_, along) => {
      const colours: Colour[] = [];
      for (let out = gap; out < gap + depth; out++) {
        const colour = sample(along, out);
        if (colour) colours.push(colour);
      }
      return colours.length ? medianColour(colours) : undefined;
    });
  const sides = {
    top: band(width, (i, out) => at(box.x + i, box.y - 1 - out)),
    bottom: band(width, (i, out) => at(box.x + i, box.y + height + out)),
    left: band(height, (i, out) => at(box.x - 1 - out, box.y + i)),
    right: band(height, (i, out) => at(box.x + width + out, box.y + i)),
  };

  const ring = Object.values(sides).flat().filter((colour): colour is Colour => colour !== undefined);
  const paper: Colour = ring.length ? medianColour(ring) : [255, 255, 255];
  const paperLight = luminance(paper);

  // Ink (letters next to the box) and missing samples become the paper's
  // colour; then each side is smoothed so single specks don't streak.
  const clean = (side: Array<Colour | undefined>): Colour[] => {
    const filled = side.map((colour) => (colour && Math.abs(luminance(colour) - paperLight) <= INK ? colour : paper));
    const reach = Math.max(1, Math.round(filled.length * 0.06));
    return filled.map((_, i) => {
      const window = filled.slice(Math.max(0, i - reach), i + reach + 1);
      return [0, 1, 2].map((channel) => window.reduce((sum, colour) => sum + colour[channel], 0) / window.length) as Colour;
    });
  };
  const top = clean(sides.top);
  const bottom = clean(sides.bottom);
  const left = clean(sides.left);
  const right = clean(sides.right);

  // The paper's grain: how much its pixels vary, ink left out.
  const grainSamples = ring.map(luminance).filter((light) => Math.abs(light - paperLight) <= INK);
  const grain = grainSamples.length
    ? Math.min(12, Math.sqrt(grainSamples.reduce((sum, light) => sum + (light - paperLight) ** 2, 0) / grainSamples.length))
    : 0;

  const corner = (a: Colour, b: Colour) => a.map((value, channel) => (value + b[channel]) / 2) as Colour;
  const topLeft = corner(top[0], left[0]);
  const topRight = corner(top[width - 1], right[0]);
  const bottomLeft = corner(bottom[0], left[height - 1]);
  const bottomRight = corner(bottom[width - 1], right[height - 1]);

  const next = random(seed);
  const gaussian = () => Math.sqrt(-2 * Math.log(next() || 1e-9)) * Math.cos(2 * Math.PI * next());
  const patch = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const t = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const s = (x + 0.5) / width;
      const noise = grain * gaussian();
      for (let channel = 0; channel < 3; channel++) {
        // A Coons patch: the four sides blended, minus the corners counted twice.
        const value =
          (1 - t) * top[x][channel] +
          t * bottom[x][channel] +
          (1 - s) * left[y][channel] +
          s * right[y][channel] -
          ((1 - s) * (1 - t) * topLeft[channel] + s * (1 - t) * topRight[channel] + (1 - s) * t * bottomLeft[channel] + s * t * bottomRight[channel]);
        patch[(y * width + x) * 3 + channel] = Math.max(0, Math.min(255, Math.round(value + noise)));
      }
    }
  }
  return patch;
}
