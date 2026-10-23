import { describe, expect, it } from 'vitest';
import { chunkPages, parsePageRanges, parsePageSelection, rangesToGroups } from '../src/core/ranges';

describe('parsePageRanges', () => {
  it('parses single pages, closed and open ranges', () => {
    expect(parsePageRanges('1-3, 5, 8-, -2', 10)).toEqual([
      { from: 1, to: 3 },
      { from: 5, to: 5 },
      { from: 8, to: 10 },
      { from: 1, to: 2 },
    ]);
  });

  it('tolerates spaces around dashes and other separators', () => {
    expect(parsePageRanges(' 2 - 4 ;6  7', 7)).toEqual([
      { from: 2, to: 4 },
      { from: 6, to: 6 },
      { from: 7, to: 7 },
    ]);
  });

  it('rejects empty input, unknown pages, backwards ranges and junk', () => {
    expect(() => parsePageRanges('  ', 3)).toThrow(/at least one page/);
    expect(() => parsePageRanges('4', 3)).toThrow("Page 4 doesn't exist. This PDF has 3 pages.");
    expect(() => parsePageRanges('0', 1)).toThrow('This PDF has 1 page.');
    expect(() => parsePageRanges('3-1', 3)).toThrow(/goes backwards/);
    expect(() => parsePageRanges('a', 3)).toThrow(/not a valid/);
    expect(() => parsePageRanges('-', 3)).toThrow(/not a valid/);
  });
});

describe('parsePageSelection', () => {
  it('returns sorted unique 0-based indices', () => {
    expect(parsePageSelection('5, 1-3, 2', 6)).toEqual([0, 1, 2, 4]);
  });
});

describe('rangesToGroups', () => {
  it('expands ranges into 0-based groups', () => {
    expect(rangesToGroups([{ from: 2, to: 3 }, { from: 1, to: 1 }])).toEqual([[1, 2], [0]]);
  });
});

describe('chunkPages', () => {
  it('splits into fixed-size groups with a shorter last group', () => {
    expect(chunkPages(5, 2)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('rejects sizes below one', () => {
    expect(() => chunkPages(5, 0)).toThrow();
    expect(() => chunkPages(5, 1.5)).toThrow();
  });
});
