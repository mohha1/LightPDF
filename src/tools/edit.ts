import { baseName, pdfOutput, readBytes } from '../browser/files';
import type { Metadata } from '../core/document';
import type { Position } from '../core/stamp';

const documentCore = () => import('../core/document');
const stampCore = () => import('../core/stamp');
import { eachInput, pageScopeFields, scopedPages } from './helpers';
import type { Tool } from './types';

const COLOR = '#8a56d6';

const MARGINS: Record<string, number> = { small: 18, recommended: 30, big: 48 };

export const pageNumbers: Tool = {
  id: 'page-numbers',
  title: 'Add page numbers',
  description: 'Number the pages of a PDF, with your choice of position and style.',
  heading: 'Add page numbers to your PDFs. Choose where they go, how they look and where they start.',
  category: 'edit',
  color: COLOR,
  icon: 'numbers',
  accepts: 'pdf',
  multiple: true,
  action: 'Add page numbers',
  working: 'Adding page numbers',
  done: 'Page numbers have been added!',
  fields: [
    { type: 'position', key: 'position', label: 'Position', default: 'bottom-center' },
    {
      type: 'choice',
      key: 'margin',
      label: 'Margin',
      default: 'recommended',
      choices: [
        { value: 'small', label: 'Small' },
        { value: 'recommended', label: 'Medium' },
        { value: 'big', label: 'Big' },
      ],
    },
    {
      type: 'select',
      key: 'format',
      label: 'Text',
      default: '{n}',
      choices: [
        { value: '{n}', label: '1' },
        { value: 'Page {n}', label: 'Page 1' },
        { value: '{n} / {total}', label: '1 / 10' },
        { value: 'Page {n} of {total}', label: 'Page 1 of 10' },
      ],
    },
    { type: 'number', key: 'startAt', label: 'First number', min: 0, step: 1, default: 1 },
    { type: 'number', key: 'fontSize', label: 'Font size', min: 4, max: 72, step: 1, default: 11 },
    { type: 'color', key: 'color', label: 'Color', default: '#000000' },
    ...pageScopeFields('number'),
  ],
  async run(context) {
    const { values } = context;
    const { addPageNumbers } = await stampCore();
    const files = await eachInput(context, async (input, bytes) => {
      const output = await addPageNumbers(bytes, {
        position: values.position as Position,
        margin: MARGINS[String(values.margin)],
        startAt: Math.round(Number(values.startAt)),
        format: String(values.format),
        fontSize: Number(values.fontSize),
        color: String(values.color),
        pages: scopedPages(values, input.pageCount!),
      });
      return pdfOutput(`${baseName(input.file.name)}-numbered.pdf`, output);
    });
    return { files, zipName: 'numbered.zip' };
  },
};

export const watermark: Tool = {
  id: 'add-watermark',
  title: 'Add watermark',
  description: 'Stamp text such as DRAFT or CONFIDENTIAL across your pages.',
  heading: 'Stamp text over your PDF pages. Pick the size, color, transparency and angle.',
  category: 'edit',
  color: COLOR,
  icon: 'watermark',
  accepts: 'pdf',
  multiple: true,
  action: 'Add watermark',
  working: 'Adding watermark',
  done: 'Your watermark has been added!',
  fields: [
    { type: 'text', key: 'text', label: 'Watermark text', placeholder: 'e.g. CONFIDENTIAL', default: 'CONFIDENTIAL' },
    {
      type: 'choice',
      key: 'layout',
      label: 'Layout',
      default: 'center',
      choices: [
        { value: 'center', label: 'Once, centered' },
        { value: 'tile', label: 'Repeated' },
      ],
    },
    {
      type: 'select',
      key: 'rotation',
      label: 'Angle',
      default: '45',
      choices: [
        { value: '0', label: 'Horizontal' },
        { value: '45', label: 'Diagonal, rising' },
        { value: '-45', label: 'Diagonal, falling' },
        { value: '90', label: 'Vertical' },
      ],
    },
    { type: 'number', key: 'fontSize', label: 'Font size', min: 6, max: 200, step: 1, default: 60 },
    { type: 'color', key: 'color', label: 'Color', default: '#e5483b' },
    { type: 'range', key: 'opacity', label: 'Opacity', min: 5, max: 100, step: 5, unit: '%', default: 30 },
    ...pageScopeFields('stamp'),
  ],
  async run(context) {
    const { values } = context;
    const { addWatermark } = await stampCore();
    const files = await eachInput(context, async (input, bytes) => {
      const output = await addWatermark(bytes, {
        text: String(values.text),
        layout: values.layout === 'tile' ? 'tile' : 'center',
        rotation: Number(values.rotation),
        fontSize: Number(values.fontSize),
        color: String(values.color),
        opacity: Number(values.opacity) / 100,
        pages: scopedPages(values, input.pageCount!),
      });
      return pdfOutput(`${baseName(input.file.name)}-watermarked.pdf`, output);
    });
    return { files, zipName: 'watermarked.zip' };
  },
};

const METADATA_FIELDS: Array<[keyof Metadata, string]> = [
  ['title', 'Title'],
  ['author', 'Author'],
  ['subject', 'Subject'],
  ['keywords', 'Keywords'],
  ['creator', 'Creator (app that made the original)'],
  ['producer', 'Producer (app that wrote the PDF)'],
];

export const metadata: Tool = {
  id: 'edit-metadata',
  title: 'Edit metadata',
  description: 'Change the title, author, subject and keywords stored in a PDF.',
  heading: 'View and change the document properties saved inside your PDF.',
  category: 'edit',
  color: COLOR,
  icon: 'tag',
  accepts: 'pdf',
  multiple: false,
  action: 'Save metadata',
  working: 'Saving metadata',
  done: 'Metadata has been updated!',
  fields: METADATA_FIELDS.map(([key, label]) => ({
    type: 'text' as const,
    key,
    label,
    default: '',
    help: key === 'keywords' ? 'Separate keywords with commas.' : undefined,
  })),
  async initialValues([input]) {
    try {
      const { readMetadata } = await documentCore();
      const current = await readMetadata(await readBytes(input.file));
      return { ...current, keywords: current.keywords.split(/\s+/).filter(Boolean).join(', ') };
    } catch {
      return {};
    }
  },
  async run({ inputs: [input], values }) {
    const next = Object.fromEntries(METADATA_FIELDS.map(([key]) => [key, String(values[key] ?? '')])) as unknown as Metadata;
    const { writeMetadata } = await documentCore();
    const output = await writeMetadata(await readBytes(input.file), next);
    return { files: [pdfOutput(input.file.name, output)] };
  },
};

export const flatten: Tool = {
  id: 'flatten-pdf',
  title: 'Flatten PDF',
  description: 'Lock in filled-out form fields so they can’t be changed.',
  heading: 'Turn fillable form fields into regular page content, so the answers can no longer be edited.',
  category: 'edit',
  color: COLOR,
  icon: 'layers',
  accepts: 'pdf',
  multiple: true,
  action: 'Flatten PDF',
  working: 'Flattening forms',
  done: 'Forms have been flattened!',
  async run(context) {
    const { flattenForms } = await documentCore();
    let fields = 0;
    const files = await eachInput(context, async (input, bytes) => {
      const result = await flattenForms(bytes);
      fields += result.fieldCount;
      return pdfOutput(`${baseName(input.file.name)}-flat.pdf`, result.bytes);
    });
    const summary =
      fields === 0
        ? 'No form fields were found, so the content is unchanged.'
        : `${fields} form field${fields === 1 ? '' : 's'} flattened.`;
    return { files, zipName: 'flattened.zip', summary };
  },
};
