import { baseName, pdfOutput, readBytes } from '../browser/files';
import { chunkPages, parsePageRanges, parsePageSelection, rangesToGroups } from '../core/ranges';
import { eachInput, pageCountHelp, pageScopeFields, scopedPages } from './helpers';
import type { Tool } from './types';

const COLOR = '#e5483b';

/** PDF processing code is loaded only when a tool runs. */
const core = () => import('../core/pages');

export const merge: Tool = {
  id: 'merge-pdf',
  title: 'Merge PDF',
  description: 'Join several PDFs into one document, in any order you choose.',
  heading: 'Join several PDFs into one file. Drag them into the order you want before merging.',
  category: 'organize',
  color: COLOR,
  icon: 'merge',
  accepts: 'pdf',
  multiple: true,
  minFiles: 2,
  ordered: true,
  action: 'Merge PDF',
  working: 'Merging PDFs',
  done: 'PDFs have been merged!',
  tips: ['Drag the files to change their order, or sort them by name.'],
  async run(context) {
    const { mergePdfs } = await core();
    const sources = await Promise.all(context.inputs.map((input) => readBytes(input.file)));
    const merged = await mergePdfs(sources, context.onProgress);
    return { files: [pdfOutput('merged.pdf', merged)] };
  },
};

export const split: Tool = {
  id: 'split-pdf',
  title: 'Split PDF',
  description: 'Break a PDF into smaller files by page ranges or page count.',
  heading: 'Break one PDF into several smaller files, by custom ranges, a fixed number of pages, or page by page.',
  category: 'organize',
  color: COLOR,
  icon: 'split',
  accepts: 'pdf',
  multiple: false,
  action: 'Split PDF',
  working: 'Splitting PDF',
  done: 'Your PDF has been split!',
  fields: [
    {
      type: 'choice',
      key: 'mode',
      default: 'ranges',
      choices: [
        { value: 'ranges', label: 'Custom ranges', description: 'Each range becomes a PDF.' },
        { value: 'every', label: 'Fixed size', description: 'A new PDF every N pages.' },
        { value: 'all', label: 'Every page', description: 'One PDF per page.' },
      ],
    },
    {
      type: 'text',
      key: 'ranges',
      label: 'Ranges',
      placeholder: 'e.g. 1-3, 4-6, 7',
      default: '',
      help: (inputs) => `Separate ranges with commas. ${pageCountHelp(inputs)}`,
      showIf: (values) => values.mode === 'ranges',
    },
    {
      type: 'checkbox',
      key: 'mergeRanges',
      label: 'Merge all ranges into one PDF',
      default: false,
      showIf: (values) => values.mode === 'ranges',
    },
    {
      type: 'number',
      key: 'size',
      label: 'Pages per PDF',
      min: 1,
      step: 1,
      default: 1,
      help: pageCountHelp,
      showIf: (values) => values.mode === 'every',
    },
  ],
  async initialValues([input]) {
    const count = input.pageCount ?? 1;
    const half = Math.ceil(count / 2);
    return { ranges: count > 1 ? `1-${half}, ${half + 1}-${count}` : '1' };
  },
  async run(context) {
    const [input] = context.inputs;
    const { extractPages, splitPdf } = await core();
    const bytes = await readBytes(input.file);
    const count = input.pageCount!;
    const name = baseName(input.file.name);
    const { values } = context;

    if (values.mode === 'ranges') {
      const ranges = parsePageRanges(String(values.ranges), count);
      if (values.mergeRanges) {
        const pages = rangesToGroups(ranges).flat();
        return { files: [pdfOutput(`${name}-pages.pdf`, await extractPages(bytes, pages))] };
      }
      const parts = await splitPdf(bytes, rangesToGroups(ranges), context.onProgress);
      return {
        files: parts.map((part, i) => {
          const { from, to } = ranges[i];
          return pdfOutput(`${name}-${from === to ? from : `${from}-${to}`}.pdf`, part);
        }),
        zipName: `${name}-split.zip`,
      };
    }

    const size = values.mode === 'all' ? 1 : Number(values.size);
    const groups = chunkPages(count, size);
    const parts = await splitPdf(bytes, groups, context.onProgress);
    return {
      files: parts.map((part, i) => {
        const first = groups[i][0] + 1;
        const last = groups[i][groups[i].length - 1] + 1;
        return pdfOutput(`${name}-${first === last ? first : `${first}-${last}`}.pdf`, part);
      }),
      zipName: `${name}-split.zip`,
    };
  },
};

export const remove: Tool = {
  id: 'remove-pages',
  title: 'Remove pages',
  description: 'Delete the pages you don’t need from a PDF.',
  heading: 'Select the pages you want to delete and get a new PDF without them.',
  category: 'organize',
  color: COLOR,
  icon: 'remove',
  accepts: 'pdf',
  multiple: false,
  action: 'Remove pages',
  working: 'Removing pages',
  done: 'Pages have been removed!',
  fields: [
    {
      type: 'text',
      key: 'pages',
      label: 'Pages to remove',
      placeholder: 'e.g. 2, 5-7',
      default: '',
      help: pageCountHelp,
    },
  ],
  async run({ inputs: [input], values }) {
    const pages = parsePageSelection(String(values.pages), input.pageCount!);
    const { removePages } = await core();
    const output = await removePages(await readBytes(input.file), pages);
    return { files: [pdfOutput(`${baseName(input.file.name)}-edited.pdf`, output)] };
  },
};

export const extract: Tool = {
  id: 'extract-pages',
  title: 'Extract pages',
  description: 'Pick the pages you need and save them as a new PDF.',
  heading: 'Choose pages from your PDF and save them as a brand new document.',
  category: 'organize',
  color: COLOR,
  icon: 'extract',
  accepts: 'pdf',
  multiple: false,
  action: 'Extract pages',
  working: 'Extracting pages',
  done: 'Pages have been extracted!',
  fields: [
    {
      type: 'text',
      key: 'pages',
      label: 'Pages to extract',
      placeholder: 'e.g. 1, 3-5',
      default: '',
      help: (inputs) => `Pages are saved in the order you type them. ${pageCountHelp(inputs)}`,
    },
  ],
  async run({ inputs: [input], values }) {
    const ranges = parsePageRanges(String(values.pages), input.pageCount!);
    const { extractPages } = await core();
    const output = await extractPages(await readBytes(input.file), rangesToGroups(ranges).flat());
    return { files: [pdfOutput(`${baseName(input.file.name)}-extract.pdf`, output)] };
  },
};

export const organize: Tool = {
  id: 'organize-pdf',
  title: 'Organize PDF',
  description: 'Reorder, rotate, duplicate or delete pages with a visual page view.',
  heading: 'See every page of your PDF, then drag, rotate, duplicate or delete pages until it is just right.',
  category: 'organize',
  color: COLOR,
  icon: 'organize',
  accepts: 'pdf',
  multiple: false,
  pageEditor: true,
  action: 'Organize',
  working: 'Organizing pages',
  done: 'Your PDF has been organized!',
  tips: ['Drag pages to reorder them. Hover a page to rotate, duplicate or delete it.'],
  async run({ inputs: [input], pages }) {
    const { organizePages } = await core();
    const output = await organizePages(await readBytes(input.file), pages);
    return { files: [pdfOutput(`${baseName(input.file.name)}-organized.pdf`, output)] };
  },
};

export const rotate: Tool = {
  id: 'rotate-pdf',
  title: 'Rotate PDF',
  description: 'Turn pages sideways or upside down, in one PDF or many at once.',
  heading: 'Fix sideways or upside-down pages. Rotate whole documents or only the pages you pick.',
  category: 'organize',
  color: COLOR,
  icon: 'rotate',
  accepts: 'pdf',
  multiple: true,
  action: 'Rotate PDF',
  working: 'Rotating PDFs',
  done: 'Pages have been rotated!',
  fields: [
    {
      type: 'choice',
      key: 'angle',
      label: 'Rotation',
      default: '90',
      choices: [
        { value: '90', label: 'Right', description: '90° clockwise' },
        { value: '180', label: 'Upside down', description: '180°' },
        { value: '270', label: 'Left', description: '90° counter-clockwise' },
      ],
    },
    ...pageScopeFields('rotate'),
  ],
  previewRotation: (values) => Number(values.angle),
  async run(context) {
    const { rotatePages } = await core();
    const angle = Number(context.values.angle);
    const files = await eachInput(context, async (input, bytes) => {
      const pages = scopedPages(context.values, input.pageCount!);
      return pdfOutput(`${baseName(input.file.name)}-rotated.pdf`, await rotatePages(bytes, angle, pages));
    });
    return { files, zipName: 'rotated.zip' };
  },
};
