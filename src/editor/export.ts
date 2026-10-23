import { formatBytes, pdfOutput, prepareImage, readBytes, type OutputFile } from '../browser/files';
import type { ComposeSource } from '../core/compose';
import type { Doc } from './model';
import { outputNames } from './naming';
import type { ExportSettings } from './settings';
import type { SourceRegistry } from './sources';

export interface ExportResult {
  files: OutputFile[];
  /** A line for the result screen, such as the space saved. */
  summary?: string;
}

export type ExportProgress = (fraction: number, label: string) => void;

/** Builds one output (or one set of images) per document. */
export async function exportDocs(
  docs: readonly Doc[],
  registry: SourceRegistry,
  settings: ExportSettings,
  onProgress: ExportProgress,
): Promise<ExportResult> {
  // Libraries for building PDFs load only now, the first time they're needed.
  const [{ Composer }, raster, { extractText }] = await Promise.all([
    import('../core/compose'),
    import('../browser/raster'),
    import('../browser/pdfjs'),
  ]);

  onProgress(0, 'Reading files');
  const sources = new Map<string, ComposeSource>();
  for (const id of new Set(docs.flatMap((doc) => doc.pages.map((page) => page.source)))) {
    const source = registry.get(id);
    if (!source) throw new Error('A file used by this document is missing.');
    sources.set(
      id,
      source.kind === 'pdf'
        ? { kind: 'pdf', bytes: await readBytes(source.file) }
        : { kind: 'image', image: await prepareImage(source.file) },
    );
  }

  const composer = new Composer(sources, settings);
  const files: OutputFile[] = [];
  let before = 0;
  let after = 0;
  let withoutText = 0;

  for (const [position, doc] of docs.entries()) {
    const label = docs.length > 1 ? `Preparing ${doc.name} (${position + 1} of ${docs.length})` : `Preparing ${doc.name}`;
    const step = (fraction: number) => onProgress((position + fraction) / docs.length, label);
    step(0);
    const names = outputNames(doc, settings.format);
    const pdf = await composer.compose(doc.pages, doc.name);

    switch (settings.format) {
      case 'pdf': {
        let best = pdf;
        if (settings.compression) {
          const compressed = await raster.rasterizePdf(pdf, settings.compression, step);
          // Never hand back a bigger file than compressing started with.
          if (compressed.length < pdf.length) best = compressed;
          before += pdf.length;
          after += best.length;
        }
        files.push(pdfOutput(names[0], best));
        break;
      }
      case 'jpg':
      case 'png': {
        const images = await raster.pdfToImages(pdf, { dpi: settings.dpi, format: settings.format }, step);
        images.forEach((blob, i) => files.push({ name: names[i], blob }));
        break;
      }
      case 'txt': {
        const text = await extractText(pdf, step);
        if (!text.trim()) withoutText++;
        files.push({ name: names[0], blob: new Blob([text], { type: 'text/plain;charset=utf-8' }) });
        break;
      }
    }
    step(1);
  }

  let summary: string | undefined;
  if (settings.compression && before > 0) {
    const saved = 1 - after / before;
    summary =
      saved > 0.005
        ? `${Math.round(saved * 100)}% smaller: ${formatBytes(before)} → ${formatBytes(after)}`
        : 'Compressing wouldn’t make these pages smaller, so they were kept as they are.';
  }
  if (withoutText > 0) {
    const lead =
      withoutText === docs.length
        ? 'No selectable text was found.'
        : `${withoutText} of ${docs.length} documents had no selectable text.`;
    summary = `${lead} Scanned pages need OCR, which LightPDF doesn't do yet.`;
  }
  return { files, summary };
}
