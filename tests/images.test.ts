import { describe, expect, it } from 'vitest';
import { jpegOrientation } from '../src/core/exif';
import { placeImage } from '../src/core/images';
import { fromBase64, JPEG_BASE64, JPEG_ROTATED_BASE64, PNG_BASE64 } from './fixtures';

describe('placeImage', () => {
  it('sizes the page to the image plus margins in fit mode', () => {
    expect(placeImage(400, 200, { pageSize: 'fit', orientation: 'portrait', margin: 10 })).toEqual({
      pageWidth: 320,
      pageHeight: 170,
      x: 10,
      y: 10,
      width: 300,
      height: 150,
    });
  });

  it('centres the image on A4 and picks landscape automatically for wide images', () => {
    const placement = placeImage(2000, 1000, { pageSize: 'a4', orientation: 'auto', margin: 0 });
    expect(placement.pageWidth).toBeCloseTo(841.89);
    expect(placement.pageHeight).toBeCloseTo(595.28);
    expect(placement.width).toBeCloseTo(841.89);
    expect(placement.height).toBeCloseTo(420.945);
    expect(placement.y).toBeCloseTo((595.28 - 420.945) / 2);
  });

  it('respects a forced orientation', () => {
    const placement = placeImage(2000, 1000, { pageSize: 'letter', orientation: 'portrait', margin: 36 });
    expect([placement.pageWidth, placement.pageHeight]).toEqual([612, 792]);
    expect(placement.width).toBeCloseTo(540);
    expect(placement.x).toBeCloseTo(36);
  });
});

describe('jpegOrientation', () => {
  it('reads the EXIF orientation tag', () => {
    expect(jpegOrientation(fromBase64(JPEG_ROTATED_BASE64))).toBe(6);
  });

  it('defaults to upright for JPEGs without EXIF, other formats and junk', () => {
    expect(jpegOrientation(fromBase64(JPEG_BASE64))).toBe(1);
    expect(jpegOrientation(fromBase64(PNG_BASE64))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 20, 0x45]))).toBe(1);
  });
});
