import { imagesToPdfTool, pdfToImagesTool, pdfToTextTool } from './convert';
import { flatten, metadata, pageNumbers, watermark } from './edit';
import { compress } from './optimize';
import { extract, merge, organize, remove, rotate, split } from './organize';
import type { Category, Tool } from './types';

export const TOOLS: Tool[] = [
  merge,
  split,
  compress,
  organize,
  imagesToPdfTool,
  pdfToImagesTool,
  rotate,
  remove,
  extract,
  pageNumbers,
  watermark,
  pdfToTextTool,
  metadata,
  flatten,
];

export const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'organize', label: 'Organize PDF' },
  { id: 'optimize', label: 'Optimize PDF' },
  { id: 'convert', label: 'Convert PDF' },
  { id: 'edit', label: 'Edit PDF' },
];

export function findTool(id: string): Tool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}
