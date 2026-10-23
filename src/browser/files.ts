import { jpegOrientation } from '../core/exif';
import type { ImageInput } from '../core/images';
import { canvasToBlob } from './pdfjs';

export async function readBytes(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function isImage(file: File): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp)$/i.test(file.name);
}

/** File name without its extension. */
export function baseName(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || 'document';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Turns an image file into something pdf-lib can embed. JPEG and PNG are used
 * as they are; other formats, and JPEGs that rely on EXIF rotation, are
 * re-encoded through a canvas so they come out upright.
 */
export async function prepareImage(file: File): Promise<ImageInput> {
  const bytes = await readBytes(file);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (isPng) return { bytes, kind: 'png' };
  if (isJpeg && jpegOrientation(bytes) === 1) return { bytes, kind: 'jpg' };

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`"${file.name}" is not an image your browser can open.`);
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = isJpeg ? await canvasToBlob(canvas, 'image/jpeg', 0.92) : await canvasToBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return { bytes: await readBytes(blob), kind: isJpeg ? 'jpg' : 'png' };
}

export interface OutputFile {
  name: string;
  blob: Blob;
}

export function pdfOutput(name: string, bytes: Uint8Array): OutputFile {
  return { name, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }) };
}

/** Packs several outputs into one ZIP, renaming duplicates. */
export async function zipOutputs(files: OutputFile[], name: string): Promise<OutputFile> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  for (const file of files) {
    let fileName = file.name;
    for (let copy = 2; used.has(fileName); copy++) {
      fileName = file.name.replace(/(\.[^.]+)?$/, ` (${copy})$1`);
    }
    used.add(fileName);
    zip.file(fileName, file.blob);
  }
  return { name, blob: await zip.generateAsync({ type: 'blob' }) };
}

export function download(file: OutputFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
