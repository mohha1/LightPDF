import { degrees, PDFRef, type PDFDocument, type PDFImage, type PDFPage } from 'pdf-lib';
import { applyCrop, MarkPainter, pageFrame, type MarkFrame } from './annotate';
import { normalizeAngle } from './angle';
import { placeImage, POINTS_PER_PIXEL, type ImageInput, type ImageLayout } from './images';
import { fillFields } from './forms';
import type { FieldValues, Mark } from './marks';
import { createPdf, loadPdf, ownContents, savePdf } from './pdf';
import { applyInfo, removeHiddenData, type DocInfo } from './sanitize';
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
  /** Values for the source PDF's own form fields, filled in from the page editor. */
  fields?: FieldValues;
}

export interface ComposeOptions {
  imageLayout: ImageLayout;
  /** Bakes form fields into the pages before anything else happens. */
  flatten: boolean;
  pageNumbers?: PageNumberOptions;
  watermark?: WatermarkOptions;
  /** Strips metadata, attachments, scripts and anything else not seen on the pages. */
  removeHidden?: boolean;
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

  /** Builds one document; `info` holds the properties set on it, which are kept even when hidden data goes. */
  async compose(pages: ComposePage[], title: string, info?: DocInfo): Promise<Uint8Array> {
    if (pages.length === 0) throw new Error('This document has no pages.');
    const doc = (await this.passThrough(pages)) ?? (await this.assemble(pages, title));
    if (this.options.pageNumbers) await stampPageNumbers(doc, this.options.pageNumbers);
    if (this.options.watermark) await stampWatermark(doc, this.options.watermark);
    if (this.options.removeHidden) removeHiddenData(doc);
    if (info) applyInfo(doc, info);
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
    fillFields(doc, fieldsOf(pages, pages[0].source));
    if (this.options.flatten) flatten(doc);
    const painter = new MarkPainter(doc);
    for (const [position, page] of doc.getPages().entries()) {
      await edit(painter, page, pages[position], pageFrame(page));
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
        // The editor showed the image itself, at 0.75 points per pixel.
        const height = image.height * POINTS_PER_PIXEL;
        await edit(painter, page, first, { box: placement, rotation: 0, height, scale: placement.height / height });
        start++;
        continue;
      }

      let end = start + 1;
      while (end < pages.length && pages[end].source === first.source) end++;
      const run = pages.slice(start, end);
      const fields = fieldsOf(pages, first.source);
      const copied = await doc.copyPages(await this.load(first.source, source.bytes, fields), run.map((page) => page.index));
      for (const [i, page] of copied.entries()) {
        doc.addPage(page);
        ownContents(page);
        await edit(painter, page, run[i], pageFrame(page));
      }
      start = end;
    }
    return doc;
  }

  /** A source PDF with its form filled in; each set of values gets its own copy. */
  private load(id: string, bytes: Uint8Array, fields: FieldValues): Promise<PDFDocument> {
    const key = `${id}:${JSON.stringify(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)))}`;
    let doc = this.loaded.get(key);
    if (!doc) {
      doc = loadPdf(bytes).then((loaded) => {
        // Form fields don't survive being copied to another document, so
        // values are drawn in, and flattening done, in the source.
        fillFields(loaded, fields);
        if (this.options.flatten) flatten(loaded);
        return loaded;
      });
      this.loaded.set(key, doc);
    }
    return doc;
  }
}

/** The page editor's changes to one page: marks, then the crop, then the extra rotation. */
async function edit(painter: MarkPainter, page: PDFPage, ref: ComposePage, frame: MarkFrame): Promise<void> {
  if (ref.marks) {
    await painter.paint(page, ref.marks, frame);
    applyCrop(page, ref.marks, frame);
  }
  rotate(page, ref.rotation);
}

/** Form values for one source from the document's pages; a later page wins. */
function fieldsOf(pages: ComposePage[], source: string): FieldValues {
  return Object.assign({}, ...pages.filter((page) => page.source === source && page.fields).map((page) => page.fields));
}

function rotate(page: PDFPage, extra: number): void {
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
