/**
 * The editor's document model. Documents are lists of references to pages of
 * uploaded files, so every edit is cheap and the model is never mutated:
 * each operation returns a new project, which makes undo a list of snapshots.
 */

import type { Mark } from '../core/marks';

export interface PageRef {
  /** Unique per page in the editor, including duplicates. */
  key: string;
  /** Id of the uploaded file the page comes from. */
  source: string;
  /** 0-based page in that file; always 0 for images. */
  index: number;
  /** Extra clockwise rotation in degrees. */
  rotation: number;
  /** Text, drawings and images added in the page editor; written into the page at export. */
  marks?: readonly Mark[];
}

export interface Doc {
  id: string;
  name: string;
  pages: PageRef[];
}

/** The documents in display order. Each one becomes one downloaded file. */
export type Project = readonly Doc[];

let counter = 0;
function nextId(prefix: string): string {
  return `${prefix}${++counter}`;
}

function newPage(source: string, index: number, rotation = 0, marks?: readonly Mark[]): PageRef {
  return marks ? { key: nextId('p'), source, index, rotation, marks } : { key: nextId('p'), source, index, rotation };
}

/** A new page showing the same as `page`: same file, page, rotation and marks. */
function copyPage(page: PageRef): PageRef {
  return newPage(page.source, page.index, page.rotation, page.marks);
}

export function createDoc(name: string, source: string, pageCount: number): Doc {
  return {
    id: nextId('d'),
    name,
    pages: Array.from({ length: pageCount }, (_, index) => newPage(source, index)),
  };
}

export function pageCount(project: Project): number {
  return project.reduce((total, doc) => total + doc.pages.length, 0);
}

/** Every page key in display order. */
export function pageKeys(project: Project): string[] {
  return project.flatMap((doc) => doc.pages.map((page) => page.key));
}

/** The keys from `from` to `to` (inclusive, either direction) in display order. */
export function keyRange(project: Project, from: string, to: string): string[] {
  const keys = pageKeys(project);
  const a = keys.indexOf(from);
  const b = keys.indexOf(to);
  if (a < 0 || b < 0) return [to];
  return keys.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function mapPages(project: Project, update: (page: PageRef) => PageRef | PageRef[] | null): Project {
  let changed = false;
  const next = project
    .map((doc) => {
      let docChanged = false;
      const pages = doc.pages.flatMap((page) => {
        const result = update(page);
        if (result !== page) docChanged = true;
        return result ?? [];
      });
      if (!docChanged) return doc;
      changed = true;
      return { ...doc, pages };
    })
    .filter((doc) => doc.pages.length > 0);
  return changed ? next : project;
}

export function rotatePages(project: Project, keys: ReadonlySet<string>, delta: number): Project {
  return mapPages(project, (page) =>
    keys.has(page.key) ? { ...page, rotation: (((page.rotation + delta) % 360) + 360) % 360 } : page,
  );
}

/** Removes pages. Documents left without pages disappear. */
export function deletePages(project: Project, keys: ReadonlySet<string>): Project {
  return mapPages(project, (page) => (keys.has(page.key) ? null : page));
}

/** Inserts a copy of each page right after it. */
export function duplicatePages(project: Project, keys: ReadonlySet<string>): Project {
  return mapPages(project, (page) => (keys.has(page.key) ? [page, copyPage(page)] : page));
}

/** Replaces the page editor's marks on one page. */
export function setPageMarks(project: Project, key: string, marks: readonly Mark[]): Project {
  return mapPages(project, (page) => {
    if (page.key !== key || page.marks === marks || (!page.marks && marks.length === 0)) return page;
    const { marks: _old, ...rest } = page;
    return marks.length ? { ...rest, marks } : rest;
  });
}

/**
 * Moves pages, keeping their display order, so that they land at `position`
 * in the target document. `position` counts the target's current pages,
 * including any that are being moved.
 */
export function movePages(project: Project, keys: ReadonlySet<string>, targetDoc: string, position: number): Project {
  const target = project.find((doc) => doc.id === targetDoc);
  const moving = project.flatMap((doc) => doc.pages.filter((page) => keys.has(page.key)));
  if (!target || moving.length === 0) return project;

  const insertAt = target.pages.slice(0, position).filter((page) => !keys.has(page.key)).length;
  const next = project
    .map((doc) => {
      const remaining = doc.pages.filter((page) => !keys.has(page.key));
      if (doc.id !== targetDoc) return { ...doc, pages: remaining };
      return { ...doc, pages: [...remaining.slice(0, insertAt), ...moving, ...remaining.slice(insertAt)] };
    })
    .filter((doc) => doc.pages.length > 0);
  return sameLayout(project, next) ? project : next;
}

/** Copies pages into a new document placed after the last document they come from. */
export function extractPages(project: Project, keys: ReadonlySet<string>): Project {
  const pages = project.flatMap((doc) => doc.pages.filter((page) => keys.has(page.key)));
  if (pages.length === 0) return project;
  const lastIndex = project.findLastIndex((doc) => doc.pages.some((page) => keys.has(page.key)));
  const doc: Doc = {
    id: nextId('d'),
    name: uniqueName(project, `${project[lastIndex].name}-extract`),
    pages: pages.map(copyPage),
  };
  return [...project.slice(0, lastIndex + 1), doc, ...project.slice(lastIndex + 1)];
}

/** Joins documents into the first of them, in display order. Merges all when `ids` is omitted. */
export function mergeDocs(project: Project, ids?: ReadonlySet<string>): Project {
  const merging = project.filter((doc) => !ids || ids.has(doc.id));
  if (merging.length < 2) return project;
  const merged: Doc = {
    id: merging[0].id,
    name: ids ? merging[0].name : uniqueName(project, `${merging[0].name}-merged`),
    pages: merging.flatMap((doc) => doc.pages),
  };
  return project.flatMap((doc) => (doc === merging[0] ? [merged] : merging.includes(doc) ? [] : [doc]));
}

/** Cuts a document in two after the page at `afterPosition`. */
export function splitDoc(project: Project, docId: string, afterPosition: number): Project {
  const index = project.findIndex((doc) => doc.id === docId);
  const doc = project[index];
  if (!doc || afterPosition < 0 || afterPosition >= doc.pages.length - 1) return project;
  const first: Doc = { ...doc, pages: doc.pages.slice(0, afterPosition + 1) };
  const second: Doc = { id: nextId('d'), name: uniqueName(project, `${doc.name}-2`), pages: doc.pages.slice(afterPosition + 1) };
  return [...project.slice(0, index), first, second, ...project.slice(index + 1)];
}

/** Turns every page of a document into its own document. */
export function splitIntoPages(project: Project, docId: string): Project {
  const index = project.findIndex((doc) => doc.id === docId);
  const doc = project[index];
  if (!doc || doc.pages.length < 2) return project;
  const singles = doc.pages.map((page, position) => ({
    id: position === 0 ? doc.id : nextId('d'),
    name: `${doc.name}-${position + 1}`,
    pages: [page],
  }));
  return [...project.slice(0, index), ...singles, ...project.slice(index + 1)];
}

export function renameDoc(project: Project, docId: string, name: string): Project {
  const trimmed = name.trim();
  return project.map((doc) => (doc.id === docId && trimmed && trimmed !== doc.name ? { ...doc, name: trimmed } : doc));
}

export function removeDoc(project: Project, docId: string): Project {
  return project.filter((doc) => doc.id !== docId);
}

/** Moves a document up (-1) or down (+1) in the list. */
export function moveDoc(project: Project, docId: string, delta: number): Project {
  const from = project.findIndex((doc) => doc.id === docId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= project.length) return project;
  const next = [...project];
  const [doc] = next.splice(from, 1);
  next.splice(to, 0, doc);
  return next;
}

export function sortDocsByName(project: Project): Project {
  const next = [...project].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return sameLayout(project, next) ? project : next;
}

/** True when both projects have the same documents, names, pages, rotations and marks. */
export function sameLayout(a: Project, b: Project): boolean {
  return (
    a.length === b.length &&
    a.every((doc, i) => {
      const other = b[i];
      return (
        doc.id === other.id &&
        doc.name === other.name &&
        doc.pages.length === other.pages.length &&
        doc.pages.every(
          (page, j) =>
            page.key === other.pages[j].key && page.rotation === other.pages[j].rotation && page.marks === other.pages[j].marks,
        )
      );
    })
  );
}

function uniqueName(project: Project, base: string): string {
  const taken = new Set(project.map((doc) => doc.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
