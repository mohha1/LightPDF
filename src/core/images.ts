export type PageSize = 'fit' | 'a4' | 'letter';
export type Orientation = 'portrait' | 'landscape' | 'auto';

export interface ImageLayout {
  pageSize: PageSize;
  orientation: Orientation;
  /** Blank space around the image, in points. */
  margin: number;
}

export interface ImageInput {
  bytes: Uint8Array;
  kind: 'jpg' | 'png';
}

export interface Placement {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const PAGE_SIZES: Record<Exclude<PageSize, 'fit'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Images are treated as 96 DPI, so one pixel is 0.75 points. */
export const POINTS_PER_PIXEL = 0.75;

/** Works out the page size and where an image of the given pixel size goes on it. */
export function placeImage(imageWidth: number, imageHeight: number, layout: ImageLayout): Placement {
  const margin = Math.max(0, layout.margin);

  if (layout.pageSize === 'fit') {
    const width = imageWidth * POINTS_PER_PIXEL;
    const height = imageHeight * POINTS_PER_PIXEL;
    return { pageWidth: width + 2 * margin, pageHeight: height + 2 * margin, x: margin, y: margin, width, height };
  }

  let [pageWidth, pageHeight] = PAGE_SIZES[layout.pageSize];
  const landscape = layout.orientation === 'landscape' || (layout.orientation === 'auto' && imageWidth > imageHeight);
  if (landscape) [pageWidth, pageHeight] = [pageHeight, pageWidth];

  const scale = Math.min((pageWidth - 2 * margin) / imageWidth, (pageHeight - 2 * margin) / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { pageWidth, pageHeight, x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}
