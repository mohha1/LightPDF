import type { Doc } from './model';
import type { Format } from './settings';

/** Removes characters that aren't allowed in file names on common systems. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim() || 'document';
}

/** The file names an export produces for one document, in order. */
export function outputNames(doc: Doc, format: Format): string[] {
  const name = safeFileName(doc.name);
  if (format === 'jpg' || format === 'png') {
    return doc.pages.length === 1
      ? [`${name}.${format}`]
      : doc.pages.map((_, i) => `${name}-${i + 1}.${format}`);
  }
  return [`${name}.${format}`];
}

/**
 * Returns `name`, or "name (2).ext", "name (3).ext"… so that it isn't in `taken`.
 * Comparison ignores case, because Windows and macOS do.
 */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  const lower = new Set([...taken].map((entry) => entry.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const match = /^(.*?)(\.[^.]*)?$/.exec(name)!;
  const base = match[1];
  const extension = match[2] ?? '';
  for (let copy = 2; ; copy++) {
    const candidate = `${base} (${copy})${extension}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}
