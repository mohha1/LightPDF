import type { OutputFile } from '../browser/files';
import type { IconName } from '../ui/icons';

export type Category = 'organize' | 'optimize' | 'convert' | 'edit';

export type Value = string | number | boolean;
export type Values = Record<string, Value>;

export interface Choice {
  value: string;
  label: string;
  description?: string;
}

interface FieldBase {
  key: string;
  label?: string;
  /** Extra guidance under the field. A function can use the loaded files. */
  help?: string | ((inputs: InputFile[], values: Values) => string);
  /** Hides the field unless this returns true. */
  showIf?: (values: Values) => boolean;
}

export type Field =
  | (FieldBase & { type: 'choice'; choices: Choice[]; default: string })
  | (FieldBase & { type: 'select'; choices: Choice[]; default: string })
  | (FieldBase & { type: 'text'; placeholder?: string; default: string })
  | (FieldBase & { type: 'number'; min?: number; max?: number; step?: number; default: number })
  | (FieldBase & { type: 'range'; min: number; max: number; step: number; unit?: string; default: number })
  | (FieldBase & { type: 'checkbox'; default: boolean })
  | (FieldBase & { type: 'color'; default: string })
  | (FieldBase & { type: 'position'; default: string });

export interface InputFile {
  file: File;
  /** Known for PDFs once they have been read. */
  pageCount?: number;
}

/** One page in the page editor. */
export interface PageItem {
  /** 0-based index in the source PDF. */
  index: number;
  /** Extra clockwise rotation in degrees. */
  rotation: number;
}

export interface RunContext {
  inputs: InputFile[];
  values: Values;
  /** Page order from the page editor, for tools that use it. */
  pages: PageItem[];
  onProgress: (fraction: number) => void;
}

export interface RunResult {
  files: OutputFile[];
  /** Name for the ZIP when there is more than one file. */
  zipName?: string;
  /** A line shown above the download button, such as the space saved. */
  summary?: string;
}

export interface Tool {
  /** URL slug, e.g. "merge-pdf". */
  id: string;
  title: string;
  /** Short text on the home page card. */
  description: string;
  /** Longer text on the tool's upload screen. */
  heading: string;
  category: Category;
  color: string;
  icon: IconName;
  accepts: 'pdf' | 'image';
  multiple: boolean;
  minFiles?: number;
  /** Label of the main button, e.g. "Merge PDF". */
  action: string;
  /** Shown while processing, e.g. "Merging PDFs". */
  working: string;
  /** Headline on the result screen, e.g. "Your PDFs have been merged!". */
  done: string;
  /** Short notes shown at the top of the options panel. */
  tips?: string[];
  fields?: Field[];
  /** Shows every page of a single PDF so pages can be reordered, rotated and deleted. */
  pageEditor?: boolean;
  /** Files can be dragged into a different order. */
  ordered?: boolean;
  /** Computes starting values once the files are loaded. */
  initialValues?: (inputs: InputFile[]) => Promise<Partial<Values>>;
  /** Rotates file thumbnails to preview the result. */
  previewRotation?: (values: Values) => number;
  run: (context: RunContext) => Promise<RunResult>;
}
