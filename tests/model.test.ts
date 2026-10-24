import { describe, expect, it } from 'vitest';
import type { Mark } from '../src/core/marks';
import {
  createDoc,
  deletePages,
  duplicatePages,
  extractPages,
  keyRange,
  mergeDocs,
  moveDoc,
  movePages,
  pageCount,
  pageKeys,
  removeDoc,
  renameDoc,
  rotatePages,
  sameLayout,
  insertPages,
  setPageEdits,
  sortDocsByName,
  splitDoc,
  splitIntoPages,
  type Project,
} from '../src/editor/model';

/** Describes a project as "name:source.index@rotation" lists for easy comparison. */
function layout(project: Project): string[] {
  return project.map(
    (doc) => `${doc.name}: ${doc.pages.map((p) => `${p.source}.${p.index}${p.rotation ? `@${p.rotation}` : ''}`).join(' ')}`,
  );
}

function sample(): Project {
  return [createDoc('a', 'A', 3), createDoc('b', 'B', 2)];
}

const keysOf = (project: Project, ...positions: Array<[number, number]>) =>
  new Set(positions.map(([doc, page]) => project[doc].pages[page].key));

describe('createDoc', () => {
  it('references every page of the source', () => {
    expect(layout(sample())).toEqual(['a: A.0 A.1 A.2', 'b: B.0 B.1']);
    expect(pageCount(sample())).toBe(5);
  });

  it('gives every page a unique key', () => {
    expect(new Set(pageKeys(sample())).size).toBe(5);
  });
});

describe('keyRange', () => {
  it('spans documents in either direction', () => {
    const project = sample();
    const keys = pageKeys(project);
    expect(keyRange(project, keys[3], keys[1])).toEqual(keys.slice(1, 4));
  });
});

describe('page operations', () => {
  it('rotates selected pages and wraps around', () => {
    const project = sample();
    const once = rotatePages(project, keysOf(project, [0, 0], [1, 1]), -90);
    expect(layout(once)).toEqual(['a: A.0@270 A.1 A.2', 'b: B.0 B.1@270']);
    expect(layout(rotatePages(once, keysOf(once, [0, 0]), 90))).toEqual(['a: A.0 A.1 A.2', 'b: B.0 B.1@270']);
  });

  it('returns the same project when nothing is selected', () => {
    const project = sample();
    expect(rotatePages(project, new Set(), 90)).toBe(project);
    expect(deletePages(project, new Set(['nope']))).toBe(project);
  });

  it('deletes pages and drops emptied documents', () => {
    const project = sample();
    expect(layout(deletePages(project, keysOf(project, [0, 1], [1, 0], [1, 1])))).toEqual(['a: A.0 A.2']);
  });

  it('duplicates pages in place with new keys', () => {
    const project = sample();
    const next = duplicatePages(project, keysOf(project, [0, 1]));
    expect(layout(next)).toEqual(['a: A.0 A.1 A.1 A.2', 'b: B.0 B.1']);
    expect(next[0].pages[1].key).not.toBe(next[0].pages[2].key);
  });
});

describe('movePages', () => {
  it('reorders within a document', () => {
    const project = sample();
    expect(layout(movePages(project, keysOf(project, [0, 0]), project[0].id, 3))).toEqual(['a: A.1 A.2 A.0', 'b: B.0 B.1']);
  });

  it('moves several pages across documents, keeping their order', () => {
    const project = sample();
    const next = movePages(project, keysOf(project, [1, 1], [0, 0]), project[1].id, 1);
    expect(layout(next)).toEqual(['a: A.1 A.2', 'b: B.0 A.0 B.1']);
  });

  it('removes a document whose pages all moved out', () => {
    const project = sample();
    const next = movePages(project, keysOf(project, [1, 0], [1, 1]), project[0].id, 0);
    expect(layout(next)).toEqual(['a: B.0 B.1 A.0 A.1 A.2']);
  });

  it('returns the same project for a drop onto the original position', () => {
    const project = sample();
    expect(movePages(project, keysOf(project, [0, 1]), project[0].id, 1)).toBe(project);
    expect(movePages(project, keysOf(project, [0, 1]), project[0].id, 2)).toBe(project);
  });
});

describe('extractPages', () => {
  it('copies pages into a new document after the last source document', () => {
    const project = sample();
    const next = extractPages(project, keysOf(project, [0, 2], [0, 0]));
    expect(layout(next)).toEqual(['a: A.0 A.1 A.2', 'a-extract: A.0 A.2', 'b: B.0 B.1']);
    expect(next[1].pages[0].key).not.toBe(project[0].pages[0].key);
  });
});

describe('document operations', () => {
  it('merges all documents', () => {
    expect(layout(mergeDocs(sample()))).toEqual(['a-merged: A.0 A.1 A.2 B.0 B.1']);
  });

  it('merges chosen documents into the first, keeping its name', () => {
    const project = [...sample(), createDoc('c', 'C', 1)];
    const next = mergeDocs(project, new Set([project[0].id, project[2].id]));
    expect(layout(next)).toEqual(['a: A.0 A.1 A.2 C.0', 'b: B.0 B.1']);
  });

  it('splits after a page and refuses to split at the end', () => {
    const project = sample();
    expect(layout(splitDoc(project, project[0].id, 0))).toEqual(['a: A.0', 'a-2: A.1 A.2', 'b: B.0 B.1']);
    expect(splitDoc(project, project[0].id, 2)).toBe(project);
  });

  it('splits into single pages', () => {
    const project = sample();
    expect(layout(splitIntoPages(project, project[0].id))).toEqual(['a-1: A.0', 'a-2: A.1', 'a-3: A.2', 'b: B.0 B.1']);
  });

  it('renames, ignoring blank names', () => {
    const project = sample();
    expect(renameDoc(project, project[0].id, '  report ')[0].name).toBe('report');
    expect(renameDoc(project, project[0].id, '   ')[0].name).toBe('a');
  });

  it('removes, moves and sorts documents', () => {
    const project = sample();
    expect(layout(removeDoc(project, project[0].id))).toEqual(['b: B.0 B.1']);
    expect(layout(moveDoc(project, project[1].id, -1))).toEqual(['b: B.0 B.1', 'a: A.0 A.1 A.2']);
    expect(moveDoc(project, project[0].id, -1)).toBe(project);
    const unsorted = [createDoc('page 10', 'X', 1), createDoc('page 9', 'Y', 1)];
    expect(sortDocsByName(unsorted).map((doc) => doc.name)).toEqual(['page 9', 'page 10']);
    expect(sortDocsByName(project)).toBe(project);
  });
});

describe('page editor marks', () => {
  const note: Mark = { type: 'whiteout', id: 'm1', x: 1, y: 2, width: 3, height: 4, color: '#ffffff' };

  it('sets and clears the marks of one page', () => {
    const project = sample();
    const key = project[0].pages[1].key;
    const marked = setPageEdits(project, key, { marks: [note], fields: {} });
    expect(marked[0].pages[1].marks).toEqual([note]);
    expect(marked[1]).toBe(project[1]);
    expect(sameLayout(project, marked)).toBe(false);
    const cleared = setPageEdits(marked, key, { marks: [], fields: {} });
    expect('marks' in cleared[0].pages[1]).toBe(false);
  });

  it('returns the same project when nothing changes', () => {
    const project = sample();
    const key = project[0].pages[0].key;
    expect(setPageEdits(project, key, { marks: [], fields: {} })).toBe(project);
    const edits = { marks: [note], fields: {} };
    const marked = setPageEdits(project, key, edits);
    expect(setPageEdits(marked, key, { ...edits, fields: marked[0].pages[0].fields ?? {} })).toBe(marked);
  });

  it('keeps marks on duplicated and extracted pages', () => {
    const project = sample();
    const key = project[0].pages[0].key;
    const withMarks = setPageEdits(project, key, { marks: [note], fields: {} });
    const duplicated = duplicatePages(withMarks, new Set([key]));
    expect(duplicated[0].pages[1].marks).toEqual(withMarks[0].pages[0].marks);
    const extracted = extractPages(withMarks, new Set([key]));
    expect(extracted[1].pages[0].marks).toEqual(withMarks[0].pages[0].marks);
  });
});

describe('insertPages', () => {
  it('inserts after a page, or at the end of the last document', () => {
    const project = sample();
    const after = insertPages(project, 'Z', 1, project[0].pages[0].key);
    expect(layout(after)).toEqual(['a: A.0 Z.0 A.1 A.2', 'b: B.0 B.1']);
    expect(layout(insertPages(project, 'Z', 1))).toEqual(['a: A.0 A.1 A.2', 'b: B.0 B.1 Z.0']);
    expect(insertPages(project, 'Z', 1, 'missing')).toBe(project);
  });
});

