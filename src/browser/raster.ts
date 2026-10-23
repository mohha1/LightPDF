import { createPdf, savePdf } from '../core/pdf';
import type { Progress } from '../core/pages';
import { canvasToBlob, openPdf, renderPage } from './pdfjs';

export interface RasterOptions {
  dpi: number;
  /** JPEG quality between 0 and 1. */
  quality: number;
}

/**
 * Rebuilds a PDF from JPEG images of its pages. Shrinks scanned and
 * image-heavy files a lot, but the text is no longer selectable.
 */
export async function rasterizePdf(bytes: Uint8Array, options: RasterOptions, onProgress?: Progress): Promise<Uint8Array> {
  const source = await openPdf(bytes);
  try {
    const output = await createPdf();
    for (let number = 1; number <= source.numPages; number++) {
      const page = await source.getPage(number);
      const size = page.getViewport({ scale: 1 });
      const canvas = await renderPage(page, options.dpi / 72);
      const jpeg = await canvasToBlob(canvas, 'image/jpeg', options.quality);
      canvas.width = canvas.height = 0;
      page.cleanup();

      const image = await output.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      output.addPage([size.width, size.height]).drawImage(image, {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      });
      onProgress?.(number / source.numPages);
    }
    return savePdf(output);
  } finally {
    await source.loadingTask.destroy();
  }
}

export type ImageFormat = 'jpg' | 'png';

/** Renders every page to an image. */
export async function pdfToImages(
  bytes: Uint8Array,
  options: { dpi: number; format: ImageFormat },
  onProgress?: Progress,
): Promise<Blob[]> {
  const doc = await openPdf(bytes);
  try {
    const images: Blob[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const canvas = await renderPage(page, options.dpi / 72);
      images.push(
        options.format === 'png'
          ? await canvasToBlob(canvas, 'image/png')
          : await canvasToBlob(canvas, 'image/jpeg', 0.92),
      );
      canvas.width = canvas.height = 0;
      page.cleanup();
      onProgress?.(number / doc.numPages);
    }
    return images;
  } finally {
    await doc.loadingTask.destroy();
  }
}
