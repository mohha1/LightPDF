import { canDeleteFiles } from '../browser/filesystem';
import type { ImageLayout, Orientation, PageSize } from '../core/images';
import { passwordProblem } from '../core/protect';
import type { PageNumberOptions, Position, WatermarkOptions } from '../core/stamp';
import type { Field, Values } from '../ui/fields';

/** Values that describe the project rather than a setting, kept beside the settings for `showIf`. */
export const HAS_IMAGES = '_hasImages';

/** Not remembered between visits, so files are never deleted by a setting someone forgot about. */
export const DELETE_ORIGINALS = 'deleteOriginals';

/** Not remembered either: a password never goes into the browser's storage. */
export const NOT_REMEMBERED = [HAS_IMAGES, DELETE_ORIGINALS, 'protect', 'password'];

const isPdf = (values: Values) => values.format === 'pdf';
const makesPages = (values: Values) => values.format !== 'txt';

export const EXPORT_FIELDS: Field[] = [
  {
    type: 'choice',
    key: 'format',
    label: 'Save as',
    default: 'pdf',
    choices: [
      { value: 'pdf', label: 'PDF' },
      { value: 'jpg', label: 'JPG' },
      { value: 'png', label: 'PNG' },
      { value: 'txt', label: 'Text' },
    ],
  },
  {
    type: 'choice',
    key: 'compression',
    label: 'Compression',
    default: 'none',
    showIf: isPdf,
    choices: [
      { value: 'none', label: 'None', description: 'Best quality. Text stays selectable.' },
      { value: 'lossless', label: 'Compact', description: 'Smaller, looks the same. Text stays selectable.' },
      { value: 'recommended', label: 'Recommended', description: 'Much smaller. Pages become images, so text can’t be selected.' },
      { value: 'extreme', label: 'Extreme', description: 'Smallest file, lower image quality. Pages become images.' },
    ],
  },
  {
    type: 'choice',
    key: 'dpi',
    label: 'Image quality',
    default: '150',
    showIf: (values) => values.format === 'jpg' || values.format === 'png',
    choices: [
      { value: '96', label: 'Low', description: '96 DPI' },
      { value: '150', label: 'Normal', description: '150 DPI' },
      { value: '300', label: 'High', description: '300 DPI' },
    ],
  },
  {
    type: 'select',
    key: 'imagePageSize',
    label: 'Page size for images',
    default: 'fit',
    showIf: (values) => Boolean(values[HAS_IMAGES]) && makesPages(values),
    choices: [
      { value: 'fit', label: 'Same as image' },
      { value: 'a4', label: 'A4 (210 × 297 mm)' },
      { value: 'letter', label: 'US Letter (8.5 × 11 in)' },
    ],
  },
  {
    type: 'choice',
    key: 'imageMargin',
    label: 'Margin around images',
    default: 'none',
    showIf: (values) => Boolean(values[HAS_IMAGES]) && makesPages(values),
    choices: [
      { value: 'none', label: 'None' },
      { value: 'small', label: 'Small' },
      { value: 'big', label: 'Big' },
    ],
  },

  { type: 'section', key: 'privacySection', label: 'Privacy', showIf: isPdf },
  {
    type: 'checkbox',
    key: 'removeHidden',
    label: 'Remove hidden data',
    default: false,
    showIf: isPdf,
    help: 'Takes out what can’t be seen on the pages: properties such as author and software, attached files, scripts, and old versions of edited content. Properties you set on a file are kept.',
  },
  { type: 'checkbox', key: 'protect', label: 'Password', default: false, showIf: isPdf },
  {
    type: 'text',
    key: 'password',
    label: 'Password to open the file',
    default: '',
    secret: true,
    showIf: (values) => isPdf(values) && Boolean(values.protect),
    help: 'Shown as you type, so you can check it. Without it nobody can open the file, LightPDF included. Encrypted with AES-256.',
  },

  { type: 'section', key: 'afterSection', label: 'After saving' },
  {
    type: 'checkbox',
    key: DELETE_ORIGINALS,
    label: 'Delete originals',
    default: false,
    disabled: !canDeleteFiles,
    help: canDeleteFiles
      ? 'Removes the files you added from your computer once the result is saved or downloaded, so only the new file is left. For several files, your browser asks once for the folder they’re in.'
      : 'Needs Chrome or Edge on a computer.',
  },

  { type: 'section', key: 'stampSection', label: 'Add to every page', showIf: makesPages },
  { type: 'checkbox', key: 'numbers', label: 'Page numbers', default: false, showIf: makesPages },
  {
    type: 'position',
    key: 'numberPosition',
    label: 'Position',
    default: 'bottom-center',
    showIf: (values) => makesPages(values) && Boolean(values.numbers),
  },
  {
    type: 'select',
    key: 'numberFormat',
    label: 'Text',
    default: '{n}',
    showIf: (values) => makesPages(values) && Boolean(values.numbers),
    choices: [
      { value: '{n}', label: '1' },
      { value: 'Page {n}', label: 'Page 1' },
      { value: '{n} / {total}', label: '1 / 10' },
      { value: 'Page {n} of {total}', label: 'Page 1 of 10' },
    ],
  },
  {
    type: 'number',
    key: 'numberStart',
    label: 'First number',
    min: 0,
    step: 1,
    default: 1,
    showIf: (values) => makesPages(values) && Boolean(values.numbers),
  },
  {
    type: 'number',
    key: 'numberSize',
    label: 'Font size',
    min: 4,
    max: 72,
    step: 1,
    default: 11,
    showIf: (values) => makesPages(values) && Boolean(values.numbers),
  },

  { type: 'checkbox', key: 'watermark', label: 'Watermark', default: false, showIf: makesPages },
  {
    type: 'text',
    key: 'watermarkText',
    label: 'Watermark text',
    placeholder: 'e.g. CONFIDENTIAL',
    default: 'CONFIDENTIAL',
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
  },
  {
    type: 'choice',
    key: 'watermarkLayout',
    label: 'Layout',
    default: 'center',
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
    choices: [
      { value: 'center', label: 'Once' },
      { value: 'tile', label: 'Repeated' },
    ],
  },
  {
    type: 'select',
    key: 'watermarkAngle',
    label: 'Angle',
    default: '45',
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
    choices: [
      { value: '0', label: 'Horizontal' },
      { value: '45', label: 'Diagonal, rising' },
      { value: '-45', label: 'Diagonal, falling' },
      { value: '90', label: 'Vertical' },
    ],
  },
  {
    type: 'number',
    key: 'watermarkSize',
    label: 'Font size',
    min: 6,
    max: 200,
    step: 1,
    default: 60,
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
  },
  {
    type: 'color',
    key: 'watermarkColor',
    label: 'Color',
    default: '#e5483b',
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
  },
  {
    type: 'range',
    key: 'watermarkOpacity',
    label: 'Opacity',
    min: 5,
    max: 100,
    step: 5,
    unit: '%',
    default: 30,
    showIf: (values) => makesPages(values) && Boolean(values.watermark),
  },

  { type: 'section', key: 'formsSection', label: 'Forms' },
  {
    type: 'checkbox',
    key: 'flatten',
    label: 'Flatten form fields',
    default: false,
    help: 'Locks filled-in answers into the page so they can’t be changed.',
  },
];

export type Format = 'pdf' | 'jpg' | 'png' | 'txt';

export interface ExportSettings {
  format: Format;
  /**
   * 'lossless' rewrites the PDF smaller and keeps it looking the same; raster
   * settings turn its pages into images; undefined keeps the PDF as it is.
   */
  compression?: 'lossless' | { dpi: number; quality: number };
  dpi: number;
  imageLayout: ImageLayout;
  flatten: boolean;
  removeHidden: boolean;
  /** Encrypts PDFs so this password is needed to open them. */
  password?: string;
  pageNumbers?: PageNumberOptions;
  watermark?: WatermarkOptions;
}

const COMPRESSION: Record<string, ExportSettings['compression']> = {
  none: undefined,
  lossless: 'lossless',
  recommended: { dpi: 144, quality: 0.65 },
  extreme: { dpi: 96, quality: 0.45 },
};

const IMAGE_MARGINS: Record<string, number> = { none: 0, small: 20, big: 50 };

/** What stops these settings from being used, if anything. */
export function settingsProblem(values: Values): string | undefined {
  return values.format === 'pdf' && values.protect ? passwordProblem(String(values.password)) : undefined;
}

export function toExportSettings(values: Values): ExportSettings {
  const format = values.format as Format;
  return {
    format,
    compression: format === 'pdf' ? COMPRESSION[String(values.compression)] : undefined,
    dpi: Number(values.dpi),
    imageLayout: {
      pageSize: values.imagePageSize as PageSize,
      orientation: 'auto' as Orientation,
      margin: IMAGE_MARGINS[String(values.imageMargin)] ?? 0,
    },
    flatten: Boolean(values.flatten),
    removeHidden: format === 'pdf' && Boolean(values.removeHidden),
    password: format === 'pdf' && values.protect ? String(values.password) : undefined,
    pageNumbers:
      values.numbers && format !== 'txt'
        ? {
            position: values.numberPosition as Position,
            margin: 30,
            startAt: Math.round(Number(values.numberStart)),
            format: String(values.numberFormat),
            fontSize: Number(values.numberSize),
            color: '#000000',
          }
        : undefined,
    watermark:
      values.watermark && format !== 'txt'
        ? {
            text: String(values.watermarkText),
            layout: values.watermarkLayout === 'tile' ? 'tile' : 'center',
            rotation: Number(values.watermarkAngle),
            fontSize: Number(values.watermarkSize),
            color: String(values.watermarkColor),
            opacity: Number(values.watermarkOpacity) / 100,
          }
        : undefined,
  };
}
