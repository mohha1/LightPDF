import { baseName, formatBytes, pdfOutput } from '../browser/files';
import { eachInput, percent } from './helpers';
import type { Tool } from './types';

const LEVELS: Record<string, { dpi: number; quality: number } | null> = {
  low: null,
  recommended: { dpi: 144, quality: 0.65 },
  extreme: { dpi: 96, quality: 0.45 },
};

export const compress: Tool = {
  id: 'compress-pdf',
  title: 'Compress PDF',
  description: 'Make PDF files smaller while keeping them readable.',
  heading: 'Shrink PDFs so they are easier to email, upload and store. Pick how hard to squeeze.',
  category: 'optimize',
  color: '#2f9e5b',
  icon: 'compress',
  accepts: 'pdf',
  multiple: true,
  action: 'Compress PDF',
  working: 'Compressing PDFs',
  done: 'Compression complete!',
  fields: [
    {
      type: 'choice',
      key: 'level',
      label: 'Compression level',
      default: 'recommended',
      choices: [
        {
          value: 'extreme',
          label: 'Extreme',
          description: 'Smallest file, lower image quality. Pages become images, so text can’t be selected.',
        },
        {
          value: 'recommended',
          label: 'Recommended',
          description: 'Good quality and a much smaller file. Pages become images, so text can’t be selected.',
        },
        {
          value: 'low',
          label: 'Lossless',
          description: 'Keeps text, links and quality exactly as they are. Saves less space.',
        },
      ],
    },
  ],
  async run(context) {
    const [{ rasterizePdf }, { optimizeLossless }] = await Promise.all([
      import('../browser/raster'),
      import('../core/document'),
    ]);
    const level = LEVELS[String(context.values.level)];
    let before = 0;
    let after = 0;
    const files = await eachInput(context, async (input, bytes, onProgress) => {
      const compressed = level ? await rasterizePdf(bytes, level, onProgress) : await optimizeLossless(bytes);
      // Never hand back a bigger file than the user started with.
      const best = compressed.length < bytes.length ? compressed : bytes;
      before += bytes.length;
      after += best.length;
      return pdfOutput(`${baseName(input.file.name)}-compressed.pdf`, best);
    });

    const saved = 1 - after / before;
    let summary = `${percent(saved)} smaller: ${formatBytes(before)} → ${formatBytes(after)}`;
    if (saved <= 0.005) {
      summary = level
        ? 'Already as compact as this level can make it, so the original was kept.'
        : 'Lossless compression couldn’t save space here. Try the Recommended level.';
    }
    return { files, zipName: 'compressed.zip', summary };
  },
};
