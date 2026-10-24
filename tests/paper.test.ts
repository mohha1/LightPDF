import { describe, expect, it } from 'vitest';
import { paperPatch, type Raster } from '../src/core/paper';

/**
 * Yellowed paper that darkens towards the bottom, with grain, a line of ink
 * touching the box's left side, and bright red inside the box (which must
 * never show up in the patch).
 */
function scan(): Raster {
  const width = 200;
  const height = 120;
  const pixels = new Uint8Array(width * height * 3);
  let seed = 7;
  const grain = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 8;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const insideBox = x >= 80 && x < 140 && y >= 40 && y < 70;
      const ink = x >= 60 && x < 80 && y >= 50 && y < 58;
      const shade = y / 4 + grain();
      const colour = insideBox ? [255, 0, 0] : ink ? [25, 25, 30] : [236 - shade, 222 - shade, 178 - shade];
      pixels.set(colour.map((value) => Math.max(0, Math.min(255, Math.round(value)))), i);
    }
  }
  return { pixels, width, height, stride: width * 3, channels: 3 };
}

const box = { x: 80, y: 40, width: 60, height: 30 };

function rows(patch: Uint8Array, from: number, to: number) {
  const sum = [0, 0, 0];
  let count = 0;
  for (let y = from; y < to; y++) {
    for (let x = 0; x < box.width; x++) {
      for (let c = 0; c < 3; c++) sum[c] += patch[(y * box.width + x) * 3 + c];
      count++;
    }
  }
  return sum.map((value) => value / count);
}

describe('paper for blank redactions', () => {
  it('matches the paper around the box, shading included', () => {
    const patch = paperPatch(scan(), box);
    const [r, g, b] = rows(patch, 0, box.height);
    // The paper there is about (222, 208, 164) on average.
    expect(Math.abs(r - 222)).toBeLessThan(6);
    expect(Math.abs(g - 208)).toBeLessThan(6);
    expect(Math.abs(b - 164)).toBeLessThan(6);
    // Darker towards the bottom, like the page.
    expect(rows(patch, box.height - 5, box.height)[0]).toBeLessThan(rows(patch, 0, 5)[0] - 3);
  });

  it('never takes anything from inside the box, nor ink next to it', () => {
    const patch = paperPatch(scan(), box);
    for (let i = 0; i < patch.length; i += 3) {
      // No red from inside, no dark ink from the left.
      expect(patch[i] - patch[i + 1]).toBeLessThan(40);
      expect(patch[i]).toBeGreaterThan(180);
    }
  });

  it('keeps some grain, and gives the same patch for the same input', () => {
    const patch = paperPatch(scan(), box, 3);
    const values = Array.from({ length: box.width }, (_, x) => patch[(10 * box.width + x) * 3]);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(2);
    expect(paperPatch(scan(), box, 3)).toEqual(patch);
  });
});
