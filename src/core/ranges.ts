/** A 1-based, inclusive page range, as users type it. */
export interface PageRange {
  from: number;
  to: number;
}

/**
 * Parses text such as "1-3, 5, 8-" into page ranges.
 *
 * Accepted tokens: `n`, `a-b`, `a-` (to the last page) and `-b` (from the first
 * page). Tokens are separated by commas, semicolons or whitespace.
 */
export function parsePageRanges(input: string, pageCount: number): PageRange[] {
  const normalized = input.replace(/\s*-\s*/g, '-');
  const tokens = normalized.split(/[,;\s]+/).filter(Boolean);
  if (tokens.length === 0) {
    throw new Error('Enter at least one page or range, for example 1-3, 5.');
  }

  return tokens.map((token) => {
    if (/^\d+$/.test(token)) {
      const page = Number(token);
      assertPage(page, pageCount);
      return { from: page, to: page };
    }

    const match = /^(\d*)-(\d*)$/.exec(token);
    if (!match || (match[1] === '' && match[2] === '')) {
      throw new Error(`"${token}" is not a valid page or range.`);
    }
    const from = match[1] === '' ? 1 : Number(match[1]);
    const to = match[2] === '' ? pageCount : Number(match[2]);
    assertPage(from, pageCount);
    assertPage(to, pageCount);
    if (from > to) {
      throw new Error(`The range "${token}" goes backwards. Write it as ${to}-${from}.`);
    }
    return { from, to };
  });
}

/** Parses a page selection into sorted, unique, 0-based page indices. */
export function parsePageSelection(input: string, pageCount: number): number[] {
  const indices = new Set<number>();
  for (const range of parsePageRanges(input, pageCount)) {
    for (let page = range.from; page <= range.to; page++) indices.add(page - 1);
  }
  return [...indices].sort((a, b) => a - b);
}

/** Turns ranges into lists of 0-based page indices, one list per range. */
export function rangesToGroups(ranges: PageRange[]): number[][] {
  return ranges.map(({ from, to }) => {
    const group: number[] = [];
    for (let page = from; page <= to; page++) group.push(page - 1);
    return group;
  });
}

/** Splits `pageCount` pages into consecutive groups of `size` pages. */
export function chunkPages(pageCount: number, size: number): number[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('The number of pages per file must be a whole number of at least 1.');
  }
  const groups: number[][] = [];
  for (let start = 0; start < pageCount; start += size) {
    const group: number[] = [];
    for (let index = start; index < Math.min(start + size, pageCount); index++) group.push(index);
    groups.push(group);
  }
  return groups;
}

function assertPage(page: number, pageCount: number): void {
  if (page < 1 || page > pageCount) {
    const pages = pageCount === 1 ? '1 page' : `${pageCount} pages`;
    throw new Error(`Page ${page} doesn't exist. This PDF has ${pages}.`);
  }
}
