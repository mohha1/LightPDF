import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/editor/model';
import { outputNames, safeFileName, uniqueFileName } from '../src/editor/naming';

describe('safeFileName', () => {
  it('replaces characters that file systems reject', () => {
    expect(safeFileName('Q1: report/final?')).toBe('Q1- report-final-');
    expect(safeFileName('  ')).toBe('document');
  });
});

describe('outputNames', () => {
  it('names one file per document, or one image per page', () => {
    const doc = createDoc('scan', 'S', 3);
    expect(outputNames(doc, 'pdf')).toEqual(['scan.pdf']);
    expect(outputNames(doc, 'txt')).toEqual(['scan.txt']);
    expect(outputNames(doc, 'png')).toEqual(['scan-1.png', 'scan-2.png', 'scan-3.png']);
    expect(outputNames(createDoc('cover', 'C', 1), 'jpg')).toEqual(['cover.jpg']);
  });
});

describe('uniqueFileName', () => {
  it('keeps free names and numbers taken ones, ignoring case', () => {
    expect(uniqueFileName('a.pdf', new Set(['b.pdf']))).toBe('a.pdf');
    expect(uniqueFileName('a.pdf', new Set(['A.PDF', 'a (2).pdf']))).toBe('a (3).pdf');
    expect(uniqueFileName('notes', new Set(['notes']))).toBe('notes (2)');
  });
});
