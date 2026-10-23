import { readBytes } from '../browser/files';
import { parsePageSelection } from '../core/ranges';
import type { Field, InputFile, RunContext, Values } from './types';

/**
 * Runs `task` for each input in turn, mapping its progress onto the overall
 * progress and naming the file in errors when there are several.
 */
export async function eachInput<T>(
  context: RunContext,
  task: (input: InputFile, bytes: Uint8Array, onProgress: (fraction: number) => void) => Promise<T>,
): Promise<T[]> {
  const { inputs } = context;
  const results: T[] = [];
  for (const [position, input] of inputs.entries()) {
    try {
      const bytes = await readBytes(input.file);
      results.push(
        await task(input, bytes, (fraction) => context.onProgress((position + fraction) / inputs.length)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(inputs.length > 1 ? `${input.file.name}: ${message}` : message);
    }
    context.onProgress((position + 1) / inputs.length);
  }
  return results;
}

export function pageCountHelp(inputs: InputFile[]): string {
  const counts = inputs.map((input) => input.pageCount).filter((count) => count !== undefined);
  if (inputs.length !== 1 || counts.length !== 1) return '';
  return counts[0] === 1 ? 'This PDF has 1 page.' : `This PDF has ${counts[0]} pages.`;
}

/** "All pages" / "Some pages" choice plus a page list, for tools that stamp or rotate. */
export function pageScopeFields(verb: string): Field[] {
  return [
    {
      type: 'choice',
      key: 'scope',
      label: `Pages to ${verb}`,
      default: 'all',
      choices: [
        { value: 'all', label: 'All pages' },
        { value: 'some', label: 'Some pages' },
      ],
    },
    {
      type: 'text',
      key: 'pageList',
      label: 'Page numbers',
      placeholder: 'e.g. 1-3, 5, 8-',
      default: '',
      help: (inputs) => pageCountHelp(inputs) || 'Applies to each PDF.',
      showIf: (values) => values.scope === 'some',
    },
  ];
}

/** Resolves the page scope fields to 0-based indices, or undefined for all pages. */
export function scopedPages(values: Values, pageCount: number): number[] | undefined {
  return values.scope === 'some' ? parsePageSelection(String(values.pageList), pageCount) : undefined;
}

export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}
