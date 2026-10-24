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

/**
 * Ink is a pixel this much lighter or darker than the paper next to it, or
 * this many times the paper's grain if that is more. The soft grey edges of
 * letters are often within that, so pixels this close to ink are left out too.
 */
const INK = { least: 12, grain: 4, most: 45, edge: 2 };

/**
 * Paper for `box`, as RGB rows: the colours along each side are taken from
 * a band of pixels just outside it (ink in that band, and the grey edges
 * around it, are left out), blended smoothly across the box so stains and
 * shading carry on, and given the paper's own grain.
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

  // Every pixel of a band, by position along a side and distance out from it.
  const band = (length: number, sample: (along: number, out: number) => Colour | undefined): Array<Array<Colour | undefined>> =>
    Array.from({ length }, (_, along) => Array.from({ length: depth }, (_, out) => sample(along, gap + out)));
  const bands = [
    band(width, (i, out) => at(box.x + i, box.y - 1 - out)),
    band(width, (i, out) => at(box.x + i, box.y + height + out)),
    band(height, (i, out) => at(box.x - 1 - out, box.y + i)),
    band(height, (i, out) => at(box.x + width + out, box.y + i)),
  ];

  // The paper's lightness along each band: the median of the pixels nearby,
  // which is the paper as long as less than half of them are ink.
  const reach = depth;
  const levels = bands.map((pixels) => {
    const step = Math.max(1, Math.floor(reach / 2));
    const sampled: number[] = [];
    for (let i = 0; i < pixels.length; i += step) {
      const nearby: number[] = [];
      for (let j = Math.max(0, i - reach); j <= Math.min(pixels.length - 1, i + reach); j++) {
        for (const colour of pixels[j]) if (colour) nearby.push(luminance(colour));
      }
      sampled.push(nearby.length ? median(nearby) : NaN);
    }
    return pixels.map((_, i) => sampled[Math.round(i / step)] ?? sampled[sampled.length - 1]);
  });

  // The paper's grain: how far its pixels stray from that, robustly, so ink
  // can be told from grain on a noisy scan as well as on a clean page.
  const strays: number[] = [];
  bands.forEach((pixels, side) =>
    pixels.forEach((column, i) => {
      for (const colour of column) {
        const stray = colour ? luminance(colour) - levels[side][i] : NaN;
        if (Math.abs(stray) <= INK.most) strays.push(stray);
      }
    }),
  );
  const centre = median(strays);
  const spread = 1.4826 * median(strays.map((stray) => Math.abs(stray - centre)));
  const limit = Math.min(INK.most, Math.max(INK.least, INK.grain * spread));

  // Each position's colour: the mean of its paper pixels, leaving out ink and
  // whatever touches it. Inside letters, paper is never quite as light, so
  // positions with ink anywhere in their band are left out as well while a
  // side has enough clean ones; positions left out are missing for now.
  const deviations: number[] = [];
  const kept: Colour[] = [];
  const lines = bands.map((pixels, side) => {
    const ink = pixels.map((column, i) => column.map((colour) => !!colour && Math.abs(luminance(colour) - levels[side][i]) > limit));
    const near = (i: number, out: number) => {
      for (let j = Math.max(0, i - INK.edge); j <= Math.min(pixels.length - 1, i + INK.edge); j++) {
        for (let k = Math.max(0, out - INK.edge); k <= Math.min(depth - 1, out + INK.edge); k++) if (ink[j][k]) return true;
      }
      return false;
    };
    const positions = pixels.map((column, i) => {
      const paper = column.filter((colour, out): colour is Colour => !!colour && !near(i, out));
      return { paper, clean: paper.length > 0 && !ink[i].includes(true) };
    });
    const clean = positions.filter((position) => position.clean).length;
    const strict = clean >= Math.max(2, positions.length * 0.2);
    return positions.map(({ paper, clean }): Colour | undefined => {
      if (paper.length === 0 || (strict && !clean)) return undefined;
      const mean = [0, 1, 2].map((channel) => paper.reduce((sum, colour) => sum + colour[channel], 0) / paper.length) as Colour;
      for (const colour of paper) deviations.push(luminance(colour) - luminance(mean));
      kept.push(...paper);
      return mean;
    });
  });
  const paper: Colour = kept.length ? medianColour(kept) : [255, 255, 255];
  const grain = deviations.length ? Math.min(12, Math.sqrt(deviations.reduce((sum, value) => sum + value ** 2, 0) / deviations.length)) : 0;

  // Missing positions take the colours on either side of them (or the paper's
  // colour if a whole side is missing); then each side is smoothed.
  const fill = (line: Array<Colour | undefined>): Colour[] => {
    const known = line.flatMap((colour, i) => (colour ? [i] : []));
    if (known.length === 0) return line.map(() => paper);
    let next = 0;
    const filled = line.map((colour, i): Colour => {
      if (colour) return colour;
      while (next < known.length && known[next] < i) next++;
      const before = known[next - 1];
      const after = known[next];
      if (before === undefined) return line[after]!;
      if (after === undefined) return line[before]!;
      const share = (i - before) / (after - before);
      return [0, 1, 2].map((channel) => line[before]![channel] * (1 - share) + line[after]![channel] * share) as Colour;
    });
    const smooth = Math.max(2, Math.round(filled.length * 0.06));
    return filled.map((_, i) => {
      const window = filled.slice(Math.max(0, i - smooth), i + smooth + 1);
      return [0, 1, 2].map((channel) => window.reduce((sum, colour) => sum + colour[channel], 0) / window.length) as Colour;
    });
  };
  const [top, bottom, left, right] = lines.map(fill);

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
