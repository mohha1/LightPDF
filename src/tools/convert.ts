import { baseName, pdfOutput, prepareImage, type OutputFile } from '../browser/files';
import { extractText } from '../browser/pdfjs';
import type { ImageFormat } from '../browser/raster';
import type { ImageInput, ImageLayout, Orientation, PageSize } from '../core/images';
import { eachInput } from './helpers';
import type { Tool } from './types';

const TO_PDF = '#e0a10b';
const FROM_PDF = '#2f7fd8';

const MARGINS: Record<string, number> = { none: 0, small: 20, big: 50 };

export const imagesToPdfTool: Tool = {
  id: 'jpg-to-pdf',
  title: 'JPG to PDF',
  description: 'Turn JPG, PNG and other images into a PDF.',
  heading: 'Turn photos and images into a PDF. Choose the page size, orientation and margins.',
  category: 'convert',
  color: TO_PDF,
  icon: 'image',
  accepts: 'image',
  multiple: true,
  ordered: true,
  action: 'Convert to PDF',
  working: 'Converting images',
  done: 'Your images are now a PDF!',
  fields: [
    {
      type: 'select',
      key: 'pageSize',
      label: 'Page size',
      default: 'a4',
      choices: [
        { value: 'a4', label: 'A4 (210 × 297 mm)' },
        { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
        { value: 'fit', label: 'Same as image' },
      ],
    },
    {
      type: 'choice',
      key: 'orientation',
      label: 'Page orientation',
      default: 'auto',
      choices: [
        { value: 'auto', label: 'Auto' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
      showIf: (values) => values.pageSize !== 'fit',
    },
    {
      type: 'choice',
      key: 'margin',
      label: 'Margin',
      default: 'none',
      choices: [
        { value: 'none', label: 'No margin' },
        { value: 'small', label: 'Small' },
        { value: 'big', label: 'Big' },
      ],
    },
    {
      type: 'checkbox',
      key: 'merge',
      label: 'Put all images in one PDF',
      default: true,
    },
  ],
  async run({ inputs, values, onProgress }) {
    const { imagesToPdf } = await import('../core/images');
    const layout: ImageLayout = {
      pageSize: values.pageSize as PageSize,
      orientation: values.orientation as Orientation,
      margin: MARGINS[String(values.margin)],
    };
    const images: ImageInput[] = [];
    for (const [i, input] of inputs.entries()) {
      images.push(await prepareImage(input.file));
      onProgress(((i + 1) / inputs.length) * 0.5);
    }

    if (values.merge) {
      const pdf = await imagesToPdf(images, layout, (p) => onProgress(0.5 + p * 0.5));
      const name = inputs.length === 1 ? baseName(inputs[0].file.name) : 'images';
      return { files: [pdfOutput(`${name}.pdf`, pdf)] };
    }
    const files: OutputFile[] = [];
    for (const [i, image] of images.entries()) {
      files.push(pdfOutput(`${baseName(inputs[i].file.name)}.pdf`, await imagesToPdf([image], layout)));
      onProgress(0.5 + ((i + 1) / images.length) * 0.5);
    }
    return { files, zipName: 'images-pdf.zip' };
  },
};

export const pdfToImagesTool: Tool = {
  id: 'pdf-to-jpg',
  title: 'PDF to JPG',
  description: 'Save every page of a PDF as a JPG or PNG image.',
  heading: 'Save each page of your PDF as a high-quality image.',
  category: 'convert',
  color: FROM_PDF,
  icon: 'photo',
  accepts: 'pdf',
  multiple: true,
  action: 'Convert to images',
  working: 'Converting pages to images',
  done: 'Your pages are now images!',
  fields: [
    {
      type: 'choice',
      key: 'format',
      label: 'Image format',
      default: 'jpg',
      choices: [
        { value: 'jpg', label: 'JPG', description: 'Smaller files' },
        { value: 'png', label: 'PNG', description: 'Lossless' },
      ],
    },
    {
      type: 'choice',
      key: 'dpi',
      label: 'Image quality',
      default: '150',
      choices: [
        { value: '96', label: 'Low', description: '96 DPI' },
        { value: '150', label: 'Normal', description: '150 DPI' },
        { value: '300', label: 'High', description: '300 DPI' },
      ],
    },
  ],
  async run(context) {
    const { pdfToImages } = await import('../browser/raster');
    const format = context.values.format as ImageFormat;
    const dpi = Number(context.values.dpi);
    const perFile = await eachInput(context, async (input, bytes, onProgress) => {
      const images = await pdfToImages(bytes, { dpi, format }, onProgress);
      const name = baseName(input.file.name);
      return images.map((blob, i) => ({ name: `${name}-${i + 1}.${format}`, blob }));
    });
    return { files: perFile.flat(), zipName: 'images.zip' };
  },
};

export const pdfToTextTool: Tool = {
  id: 'pdf-to-text',
  title: 'PDF to Text',
  description: 'Pull all the text out of a PDF into a plain .txt file.',
  heading: 'Copy the text out of your PDFs into plain text files you can edit anywhere.',
  category: 'convert',
  color: FROM_PDF,
  icon: 'text',
  accepts: 'pdf',
  multiple: true,
  action: 'Extract text',
  working: 'Extracting text',
  done: 'Your text is ready!',
  tips: ['Scanned documents contain pictures of text, not text, so they come out empty.'],
  async run(context) {
    let empty = 0;
    const files = await eachInput(context, async (input, bytes, onProgress) => {
      const text = await extractText(bytes, onProgress);
      if (!text.trim()) empty++;
      return {
        name: `${baseName(input.file.name)}.txt`,
        blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
      };
    });
    const lead =
      empty === files.length ? 'No selectable text was found.' : `${empty} of ${files.length} files had no selectable text.`;
    const summary = empty > 0 ? `${lead} Scanned pages need OCR, which LightPDF doesn't do yet.` : undefined;
    return { files, zipName: 'text.zip', summary };
  },
};
