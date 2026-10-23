import { degrees, PDFRef, type PDFDocument, type PDFImage } from 'pdf-lib';
import { MarkPainter, pageFrame } from './annotate';
import { normalizeAngle } from './angle';
import { placeImage, POINTS_PER_PIXEL, type ImageInput, type ImageLayout } from './images';
import type { Mark } from './marks';
import { createPdf, loadPdf, ownContents, savePdf } from './pdf';
import { stampPageNumbers, stampWatermark, type PageNumberOptions, type WatermarkOptions } from './stamp';

export type ComposeSource = { kind: 'pdf'; bytes: Uint8Array } | { kind: 'image'; image: ImageInput };

/** One page of the output: a page of a source file plus extra clockwise rotation. */
export interface ComposePage {
  source: string;
  /** 0-based page in the source; always 0 for images. */
  index: number;
  rotation: number;
  /** Drawn on the page from the page editor, before the extra rotation. */
  marks?: readonly Mark[];
}

export interface ComposeOptions {
  imageLayout: ImageLayout;
  /** Bakes form fields into the pages before anything else happens. */
  flatten: boolean;
  pageNumbers?: PageNumberOptions;
  watermark?: WatermarkOptions;
}

/**
 * Builds output PDFs from pages of uploaded files. One Composer is shared by
 * all documents of an export, so each source PDF is parsed only once.
 */
export class Composer {
  private loaded = new Map<string, Promise<PDFDocument>>();

  constructor(
    private sources: Map<string, ComposeSource>,
    private options: ComposeOptions,
  ) {}

  async compose(pages: ComposePage[], title: string): Promise<Uint8Array> {
    if (pages.length === 0) throw new Error('This document has no pages.');
    const doc = (await this.passThrough(pages)) ?? (await this.assemble(pages, title));
    if (this.options.pageNumbers) await stampPageNumbers(doc, this.options.pageNumbers);
    if (this.options.watermark) await stampWatermark(doc, this.options.watermark);
    return savePdf(doc);
  }

  /**
   * When the pages are exactly one PDF's pages in their original order, edits
   * that PDF itself so its bookmarks, links, forms and metadata survive.
   */
  private async passThrough(pages: ComposePage[]): Promise<PDFDocument | undefined> {
    const source = this.sources.get(pages[0].source);
    if (source?.kind !== 'pdf') return undefined;
    if (!pages.every((page, position) => page.source === pages[0].source && page.index === position)) return undefined;

    const doc = await loadPdf(source.bytes);
    if (doc.getPageCount() !== pages.length) return undefined;
    if (this.options.flatten) flatten(doc);
    const painter = new MarkPainter(doc);
    for (const [position, page] of doc.getPages().entries()) {
      const { marks, rotation } = pages[position];
      if (marks) await painter.paint(page, marks, pageFrame(page));
      rotate(page, rotation);
    }
    return doc;
  }

  private async assemble(pages: ComposePage[], title: string): Promise<PDFDocument> {
    const doc = await createPdf();
    doc.setTitle(title);
    const images = new Map<string, PDFImage>();
    const painter = new MarkPainter(doc);

    // Copy runs of consecutive pages from the same PDF in one call.
    for (let start = 0; start < pages.length; ) {
      const first = pages[start];
      const source = this.sources.get(first.source);
      if (!source) throw new Error('A file used by this document is missing.');

      if (source.kind === 'image') {
        let image = images.get(first.source);
        if (!image) {
          image = source.image.kind === 'jpg' ? await doc.embedJpg(source.image.bytes) : await doc.embedPng(source.image.bytes);
          images.set(first.source, image);
        }
        const placement = placeImage(image.width, image.height, this.options.imageLayout);
        const page = doc.addPage([placement.pageWidth, placement.pageHeight]);
        page.drawImage(image, { x: placement.x, y: placement.y, width: placement.width, height: placement.height });
        if (first.marks) {
          // The editor showed the image itself, at 0.75 points per pixel.
          const height = image.height * POINTS_PER_PIXEL;
          await painter.paint(page, first.marks, { box: placement, rotation: 0, height, scale: placement.height / height });
        }
        rotate(page, first.rotation);
        start++;
        continue;
      }

      let end = start + 1;
      while (end < pages.length && pages[end].source === first.source) end++;
      const run = pages.slice(start, end);
      const copied = await doc.copyPages(await this.load(first.source, source.bytes), run.map((page) => page.index));
      for (const [i, page] of copied.entries()) {
        doc.addPage(page);
        ownContents(page);
        const { marks, rotation } = run[i];
        if (marks) await painter.paint(page, marks, pageFrame(page));
        rotate(page, rotation);
      }
      start = end;
    }
    return doc;
  }

  private load(id: string, bytes: Uint8Array): Promise<PDFDocument> {
    let doc = this.loaded.get(id);
    if (!doc) {
      doc = loadPdf(bytes).then((loaded) => {
        // Form fields don't survive being copied to another document, so
        // flattening has to happen in the source.
        if (this.options.flatten) flatten(loaded);
        return loaded;
      });
      this.loaded.set(id, doc);
    }
    return doc;
  }
}

function rotate(page: ReturnType<PDFDocument['getPage']>, extra: number): void {
  if (extra) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + extra)));
}

function flatten(doc: PDFDocument): void {
  const form = doc.getForm();
  if (form.getFields().length === 0) return;
  try {
    form.flatten();
  } catch {
    throw new Error("A PDF's form uses features that can't be flattened in the browser.");
  }
  // pdf-lib deletes the field widgets but can leave references to them in the
  // pages' annotation lists; drop those dangling references.
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const entry = annots.get(i);
      if (entry instanceof PDFRef && doc.context.lookup(entry) === undefined) annots.remove(i);
    }
  }
}
