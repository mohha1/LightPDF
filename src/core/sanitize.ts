import { PDFArray, PDFDict, PDFName, PDFRef, PDFStream, type PDFDocument, type PDFObject } from 'pdf-lib';

/** Document properties a person can set on a file. */
export interface DocInfo {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

const INFO_KEYS: Record<keyof DocInfo, string> = { title: 'Title', author: 'Author', subject: 'Subject', keywords: 'Keywords' };

/** Sets the properties given; an empty one is removed from the file. */
export function applyInfo(doc: PDFDocument, info: DocInfo): void {
  for (const [key, name] of Object.entries(INFO_KEYS) as Array<[keyof DocInfo, string]>) {
    const value = info[key];
    if (value === undefined) continue;
    if (!value.trim()) doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict)?.delete(PDFName.of(name));
    else if (key === 'title') doc.setTitle(value.trim());
    else if (key === 'author') doc.setAuthor(value.trim());
    else if (key === 'subject') doc.setSubject(value.trim());
    else doc.setKeywords(value.split(',').map((word) => word.trim()).filter(Boolean));
  }
}

/** Actions that run code, open other files or send data somewhere. */
const RISKY_ACTIONS = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToE', 'GoToR', 'Rendition', 'Sound', 'Movie', 'RichMediaExecute']);
/** Annotations that carry files or media rather than marks on the page. */
const RISKY_ANNOTATIONS = new Set(['FileAttachment', 'Sound', 'Movie', 'Screen', 'RichMedia', '3D']);
/** Entries that hold data nobody sees on the pages (AF and EF hold attached files). */
const HIDDEN_KEYS = ['Metadata', 'PieceInfo', 'Thumb', 'AA', 'JS', 'OpenAction', 'SpiderInfo', 'Perms', 'Collection', 'XFA', 'AF', 'EF'];

/**
 * Removes what a reader of the pages doesn't see: every document property
 * (title, author, software, dates) and XMP metadata, attached files, scripts
 * and actions that run code, open files or send data, embedded thumbnails,
 * application data and XFA forms. Links within the file and to web pages
 * stay. Objects nothing refers to any more, including old revisions kept by
 * incremental saves, are dropped.
 */
export function removeHiddenData(doc: PDFDocument): void {
  const context = doc.context;
  const info = context.lookup(context.trailerInfo.Info);
  if (info instanceof PDFDict) for (const key of info.keys()) info.delete(key);

  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  names?.delete(PDFName.of('JavaScript'));
  names?.delete(PDFName.of('EmbeddedFiles'));

  const seen = new Set<PDFObject>();
  const visit = (object: PDFObject | undefined) => {
    const target = object instanceof PDFRef ? context.lookup(object) : object;
    if (!target || seen.has(target)) return;
    seen.add(target);
    const dict = target instanceof PDFStream ? target.dict : target instanceof PDFDict ? target : undefined;
    if (dict) {
      for (const key of HIDDEN_KEYS) dict.delete(PDFName.of(key));
      for (const key of ['A', 'Next']) {
        const action = dict.lookupMaybe(PDFName.of(key), PDFDict);
        const kind = action?.lookupMaybe(PDFName.of('S'), PDFName)?.decodeText();
        if (kind && RISKY_ACTIONS.has(kind)) dict.delete(PDFName.of(key));
      }
      const annots = dict.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (annots) {
        for (let i = annots.size() - 1; i >= 0; i--) {
          const subtype = annots.lookupMaybe(i, PDFDict)?.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
          if (subtype && RISKY_ANNOTATIONS.has(subtype)) annots.remove(i);
        }
      }
      // Page contents are drawing instructions, not hidden data; don't walk into them.
      for (const [key, value] of dict.entries()) if (key !== PDFName.of('Contents') && key !== PDFName.of('Parent')) visit(value);
    } else if (target instanceof PDFArray) {
      for (const value of target.asArray()) visit(value);
    }
  };
  visit(doc.catalog);
  for (const page of doc.getPages()) visit(page.node);

  dropUnreachable(doc);
}

/** Deletes every object that can't be reached from the file's trailer. */
export function dropUnreachable(doc: PDFDocument): void {
  const context = doc.context;
  const reached = new Set<PDFRef>();
  const pending: PDFObject[] = [context.trailerInfo.Root, context.trailerInfo.Info, context.trailerInfo.Encrypt].filter(
    (object): object is PDFObject => object !== undefined,
  );
  while (pending.length) {
    const object = pending.pop()!;
    if (object instanceof PDFRef) {
      if (reached.has(object)) continue;
      reached.add(object);
      const target = context.lookup(object);
      if (target) pending.push(target);
    } else if (object instanceof PDFStream) {
      pending.push(object.dict);
    } else if (object instanceof PDFDict) {
      for (const [, value] of object.entries()) pending.push(value);
    } else if (object instanceof PDFArray) {
      pending.push(...object.asArray());
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (!reached.has(ref)) context.delete(ref);
  }
}
