import type { PDFDocumentProxy } from 'pdfjs-dist';
import { isPdf, readBytes } from '../browser/files';
import { openPdf, renderPage, renderThumbnail } from '../browser/pdfjs';
import { POINTS_PER_PIXEL } from '../core/images';
import type { FieldValue, Rect, Size } from '../core/marks';

export interface Source {
  id: string;
  /** An in-memory copy, so the editor keeps working if the file on disk changes or is deleted. */
  file: File;
  kind: 'pdf' | 'image';
  pageCount: number;
  /** The file on disk, when the browser gave access to it. */
  handle?: FileSystemFileHandle;
  /** Set once LightPDF has deleted the file on disk. */
  deleted?: boolean;
  /** Made by LightPDF (a blank page), so there is no original to delete. */
  generated?: boolean;
}

/** What a PDF holds besides its pages, for the Properties dialog. */
export interface FileDetails {
  /** The file's document properties (Title, Author, Producer, CreationDate…). */
  info: Record<string, string>;
  /** XMP metadata, a second copy of the properties that can hold more. */
  hasXmp: boolean;
  attachments: string[];
  /** Scripts that run when the file is opened or used. */
  hasScripts: boolean;
}

/** One of a PDF's own form fields on a page, as the page editor shows it. */
export interface FormField {
  /** The field's full name, which identifies it in the file. */
  name: string;
  kind: 'text' | 'checkbox' | 'radio' | 'choice' | 'list';
  /** Where its box is, in the page editor's coordinates. */
  rect: Rect;
  /** The value in the file. */
  value: FieldValue;
  /** Choices of a drop-down or list. */
  options: string[];
  /** The value this checkbox or radio button stands for. */
  onValue: string;
  multiline: boolean;
  readOnly: boolean;
  maxLength?: number;
}

/** Thumbnails are rendered once at this size and scaled with CSS for zooming. */
const THUMB_SIZE = 260;
/** How many thumbnails render at the same time. */
const CONCURRENCY = 2;

let counter = 0;

/**
 * The files added to the editor. PDFs stay open in PDF.js for the whole
 * session so thumbnails render without re-reading the file.
 */
export class SourceRegistry {
  private sources = new Map<string, Source>();
  private pdfs = new Map<string, PDFDocumentProxy>();
  private imageUrls = new Map<string, string>();
  private thumbs = new Map<string, Promise<string>>();
  private ready = new Map<string, string>();
  private sizes = new Map<string, Promise<Size>>();
  private queue: Array<() => void> = [];
  private active = 0;

  /** Opens a file. Throws a readable error for damaged or protected PDFs. */
  async add(original: File, handle?: FileSystemFileHandle): Promise<Source> {
    const id = `s${++counter}`;
    const bytes = await readBytes(original);
    const file = new File([bytes as Uint8Array<ArrayBuffer>], original.name, {
      type: original.type,
      lastModified: original.lastModified,
    });
    let source: Source;
    if (isPdf(file)) {
      const pdf = await openPdf(bytes);
      this.pdfs.set(id, pdf);
      source = { id, file, kind: 'pdf', pageCount: pdf.numPages, handle };
    } else {
      const url = URL.createObjectURL(file);
      const image = await loadImage(url, file.name);
      this.imageUrls.set(id, url);
      this.sizes.set(`${id}:0`, Promise.resolve({ width: image.naturalWidth * POINTS_PER_PIXEL, height: image.naturalHeight * POINTS_PER_PIXEL }));
      this.ready.set(`${id}:0`, url);
      source = { id, file, kind: 'image', pageCount: 1, handle };
    }
    this.sources.set(id, source);
    return source;
  }

  get(id: string): Source | undefined {
    return this.sources.get(id);
  }

  /** Drops the link to files on disk that were deleted; the in-memory copies stay. */
  forgetHandles(handles: FileSystemFileHandle[]): void {
    for (const source of this.sources.values()) {
      if (source.handle && handles.includes(source.handle)) {
        source.handle = undefined;
        source.deleted = true;
      }
    }
  }

  /** A thumbnail that is already rendered, if any. */
  cachedThumbnail(id: string, index: number): string | undefined {
    return this.ready.get(`${id}:${index}`);
  }

  thumbnail(id: string, index: number): Promise<string> {
    const key = `${id}:${index}`;
    const cached = this.ready.get(key);
    if (cached) return Promise.resolve(cached);
    let pending = this.thumbs.get(key);
    if (!pending) {
      pending = this.limit(async () => {
        const pdf = this.pdfs.get(id);
        if (!pdf) throw new Error('This file is no longer open.');
        const page = await pdf.getPage(index + 1);
        const url = await renderThumbnail(page, THUMB_SIZE);
        page.cleanup();
        this.ready.set(key, url);
        return url;
      });
      this.thumbs.set(key, pending);
      // Allow a retry later if rendering failed.
      pending.catch(() => this.thumbs.delete(key));
    }
    return pending;
  }

  /**
   * A page's size in points as viewers show the original file (an image's at
   * 0.75 points per pixel): the space the page editor's marks live in.
   */
  pageSize(id: string, index: number): Promise<Size> {
    const key = `${id}:${index}`;
    let size = this.sizes.get(key);
    if (!size) {
      size = this.pdfPage(id, index).then((page) => {
        const { width, height } = page.getViewport({ scale: 1 });
        return { width, height };
      });
      this.sizes.set(key, size);
      size.catch(() => this.sizes.delete(key));
    }
    return size;
  }

  /** The form fields (text boxes, checkboxes, radio buttons, lists) on a page of a PDF. */
  async formFields(id: string, index: number): Promise<FormField[]> {
    if (!this.pdfs.has(id)) return [];
    const page = await this.pdfPage(id, index);
    const viewport = page.getViewport({ scale: 1 });
    const annotations = await page.getAnnotations({ intent: 'display' });
    return annotations.flatMap((annotation): FormField[] => {
      const data = annotation as Record<string, unknown> & { rect: number[] };
      if (data.subtype !== 'Widget' || data.hidden || typeof data.fieldName !== 'string' || !data.fieldName) return [];
      const [x1, y1] = viewport.convertToViewportPoint(data.rect[0], data.rect[1]) as number[];
      const [x2, y2] = viewport.convertToViewportPoint(data.rect[2], data.rect[3]) as number[];
      const rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
      const common = { name: data.fieldName, rect, readOnly: Boolean(data.readOnly), multiline: false, options: [], onValue: '' };
      const options = Array.isArray(data.options) ? (data.options as Array<{ exportValue: string; displayValue: string }>) : [];
      const display = (value: unknown) => options.find((option) => option.exportValue === value)?.displayValue ?? String(value ?? '');
      switch (data.fieldType) {
        case 'Tx':
          return [{ ...common, kind: 'text', value: String(data.fieldValue ?? ''), multiline: Boolean(data.multiLine), maxLength: Number(data.maxLen) || undefined }];
        case 'Btn':
          if (data.checkBox) return [{ ...common, kind: 'checkbox', value: data.fieldValue === data.exportValue, onValue: String(data.exportValue) }];
          if (data.radioButton) {
            const onValue = String(data.buttonValue);
            return [{ ...common, kind: 'radio', value: data.fieldValue === onValue ? onValue : '', onValue }];
          }
          return [];
        case 'Ch': {
          const values = (Array.isArray(data.fieldValue) ? data.fieldValue : [data.fieldValue]).filter((value) => value !== undefined && value !== null && value !== '');
          const labels = options.map((option) => option.displayValue);
          return data.combo
            ? [{ ...common, kind: 'choice', value: values.length ? display(values[0]) : '', options: labels }]
            : [{ ...common, kind: 'list', value: values.map(display), options: labels }];
        }
        default:
          return [];
      }
    });
  }

  /** The properties, attachments and scripts in a PDF. */
  async details(id: string): Promise<FileDetails | undefined> {
    const pdf = this.pdfs.get(id);
    if (!pdf) return undefined;
    const [{ info, metadata }, attachments, scripts] = await Promise.all([
      pdf.getMetadata(),
      pdf.getAttachments().catch(() => null),
      pdf.hasJSActions().catch(() => false),
    ]);
    const strings = Object.fromEntries(
      Object.entries(info as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== ''),
    );
    return {
      info: strings,
      hasXmp: Boolean(metadata),
      attachments: attachments ? [...attachments.values()].map((file) => String((file as { filename?: string }).filename ?? 'file')) : [],
      hasScripts: Boolean(scripts),
    };
  }

  /** Adds a file LightPDF made itself, such as a blank page. */
  async addGenerated(bytes: Uint8Array, name: string): Promise<Source> {
    const source = await this.add(new File([bytes as Uint8Array<ArrayBuffer>], name, { type: 'application/pdf' }));
    source.generated = true;
    return source;
  }

  /** Draws a page for the page editor, turned clockwise by `rotation`, at `scale` pixels per point. */
  async render(id: string, index: number, scale: number, rotation: number): Promise<HTMLCanvasElement> {
    const url = this.imageUrls.get(id);
    if (!url) {
      const page = await this.pdfPage(id, index);
      // Without form fields: the page editor lays its own inputs over them.
      const canvas = await renderPage(page, scale, rotation, false);
      page.cleanup();
      return canvas;
    }
    const image = await loadImage(url, this.sources.get(id)?.file.name ?? 'image');
    const sideways = rotation % 180 !== 0;
    const width = image.naturalWidth * POINTS_PER_PIXEL * scale;
    const height = image.naturalHeight * POINTS_PER_PIXEL * scale;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sideways ? height : width));
    canvas.height = Math.max(1, Math.round(sideways ? width : height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not create a drawing surface.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, -width / 2, -height / 2, width, height);
    return canvas;
  }

  private async pdfPage(id: string, index: number) {
    const pdf = this.pdfs.get(id);
    if (!pdf) throw new Error('This file is no longer open.');
    return pdf.getPage(index + 1);
  }

  /** Closes every file. */
  clear(): void {
    this.pdfs.forEach((pdf) => void pdf.loadingTask.destroy());
    this.imageUrls.forEach((url) => URL.revokeObjectURL(url));
    this.sources.clear();
    this.pdfs.clear();
    this.imageUrls.clear();
    this.thumbs.clear();
    this.ready.clear();
    this.sizes.clear();
  }

  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENCY) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

function loadImage(url: string, name: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`"${name}" is not an image your browser can open.`));
    image.src = url;
  });
}
