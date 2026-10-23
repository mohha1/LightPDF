import { degrees, type PDFDocument } from 'pdf-lib';
import { normalizeAngle } from './angle';
import { createPdf, loadPdf, savePdf, type Bytes } from './pdf';

export type Progress = (fraction: number) => void;

/** Combines several PDFs into one, in the given order. */
export async function mergePdfs(sources: Bytes[], onProgress?: Progress): Promise<Bytes> {
  const merged = await createPdf();
  for (const [index, bytes] of sources.entries()) {
    const source = await loadPdf(bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
    onProgress?.((index + 1) / sources.length);
  }
  return savePdf(merged);
}

/** Builds a new PDF from the given 0-based page indices, in that order. */
export async function extractPages(bytes: Bytes, indices: number[]): Promise<Bytes> {
  const source = await loadPdf(bytes);
  return savePdf(await copyIntoNewPdf(source, indices));
}

/** Creates one PDF per group of 0-based page indices. */
export async function splitPdf(bytes: Bytes, groups: number[][], onProgress?: Progress): Promise<Bytes[]> {
  const source = await loadPdf(bytes);
  const outputs: Bytes[] = [];
  for (const group of groups) {
    outputs.push(await savePdf(await copyIntoNewPdf(source, group)));
    onProgress?.(outputs.length / groups.length);
  }
  return outputs;
}

/** Deletes the given 0-based pages, keeping everything else in the document. */
export async function removePages(bytes: Bytes, indices: number[]): Promise<Bytes> {
  const doc = await loadPdf(bytes);
  const toRemove = new Set(indices);
  if (toRemove.size >= doc.getPageCount()) {
    throw new Error("You can't remove every page. Leave at least one page in the PDF.");
  }
  [...toRemove].sort((a, b) => b - a).forEach((index) => doc.removePage(index));
  return savePdf(doc);
}

/** Rotates pages clockwise by `angle` degrees. Rotates all pages when `indices` is omitted. */
export async function rotatePages(bytes: Bytes, angle: number, indices?: number[]): Promise<Bytes> {
  const doc = await loadPdf(bytes);
  const pages = doc.getPages();
  for (const index of indices ?? doc.getPageIndices()) {
    const page = pages[index];
    page.setRotation(degrees(normalizeAngle(page.getRotation().angle + angle)));
  }
  return savePdf(doc);
}

export interface PageInstruction {
  /** 0-based index of the page in the source document. */
  index: number;
  /** Extra clockwise rotation, in degrees. */
  rotation: number;
}

/** Reorders, rotates and drops pages in one pass. */
export async function organizePages(bytes: Bytes, instructions: PageInstruction[]): Promise<Bytes> {
  if (instructions.length === 0) throw new Error('There are no pages left to save.');
  const source = await loadPdf(bytes);
  const doc = await copyIntoNewPdf(
    source,
    instructions.map((instruction) => instruction.index),
  );
  doc.getPages().forEach((page, position) => {
    const extra = instructions[position].rotation;
    if (extra) page.setRotation(degrees(normalizeAngle(page.getRotation().angle + extra)));
  });
  return savePdf(doc);
}

async function copyIntoNewPdf(source: PDFDocument, indices: number[]): Promise<PDFDocument> {
  const doc = await createPdf();
  const pages = await doc.copyPages(source, indices);
  pages.forEach((page) => doc.addPage(page));
  return doc;
}
