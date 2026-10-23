import { baseName, download, formatBytes, isImage, isPdf, zipOutputs } from '../browser/files';
import {
  canDeleteFiles,
  canPickFiles,
  canSaveAs,
  chooseDestination,
  deleteFiles,
  filesFromDrop,
  lacksWriteAccess,
  pickFiles,
  requestAccess,
  requestWriteAccess,
  writeOutputs,
  type DeleteResult,
  type Destination,
  type PickedFile,
} from '../browser/filesystem';
import type { Mark } from '../core/marks';
import { progressDialog, type DialogAction, type DialogState, type ProgressDialog } from '../ui/dialog';
import { h, replaceChildren, type Child } from '../ui/dom';
import type { Values } from '../ui/fields';
import { icon, type IconName } from '../ui/icons';
import { defaultValues, renderOptions, type OptionsPanel } from '../ui/options';
import { toast } from '../ui/toast';
import { enablePageDrag } from './drag';
import { exportDocs } from './export';
import { History } from './history';
import { renderLanding } from './landing';
import * as model from './model';
import { outputNames, safeFileName } from './naming';
import { DELETE_ORIGINALS, EXPORT_FIELDS, HAS_IMAGES, toExportSettings } from './settings';
import { SourceRegistry } from './sources';

const SETTINGS_KEY = 'lightpdf:export-settings';
const ZOOM_KEY = 'lightpdf:zoom';
const ZOOM = { min: 100, max: 260, default: 150 };
/** Cards: the narrowest a card's inside may be (its four action buttons), and the page size on narrow screens. */
const CARD = { minInner: 104, narrowThumb: 112, narrow: '(max-width: 800px)' };

/** Thumbnails of pages with marks are drawn at most this many pixels on their long side. */
const MARKED_THUMB = 520;

class Cancelled extends Error {}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "a.pdf", "a.pdf and b.pdf", "a.pdf, b.pdf and 3 more". */
function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** Originals to delete once the result is saved or downloaded. */
interface Cleanup {
  handles: FileSystemFileHandle[];
  /** Originals that were added without access to the file on disk. */
  missing: string[];
  written: FileSystemFileHandle[];
  /**
   * The result went to the downloads folder. The browser can't confirm the
   * download finished, so the dialog says how to recover if it didn't.
   */
  afterDownload: boolean;
}

function readStorage(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private mode, blocked cookies); settings just won't persist.
  }
}

/** Restores saved export settings, ignoring keys that no longer exist or changed type. */
function initialValues(): Values {
  const values = defaultValues(EXPORT_FIELDS);
  const stored = readStorage(SETTINGS_KEY);
  if (stored && typeof stored === 'object') {
    for (const [key, value] of Object.entries(stored)) {
      if (key in values && key !== DELETE_ORIGINALS && typeof value === typeof values[key]) values[key] = value as Values[string];
    }
  }
  return values;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

/** The whole app: a landing page until files are added, then the editor. */
export function mountEditor(root: HTMLElement): void {
  const registry = new SourceRegistry();
  const history = new History<model.Project>([]);
  const values = initialValues();
  let selection = new Set<string>();
  let anchor: string | undefined;
  let opening = 0;
  let busy = false;
  /** Pages on screen by key, for their thumbnails. */
  let shown = new Map<string, model.PageRef>();
  const markedThumbs = new WeakMap<readonly Mark[], Promise<string>>();
  const storedZoom = Number(readStorage(ZOOM_KEY));
  let zoom = storedZoom >= ZOOM.min && storedZoom <= ZOOM.max ? storedZoom : ZOOM.default;

  const project = () => history.present;

  // ------------------------------------------------------------------ shell

  const screen = h('div', { class: 'screen' });
  const fileInput = h('input', {
    type: 'file',
    hidden: true,
    multiple: true,
    accept: 'application/pdf,.pdf,image/*',
    onchange: () => {
      const files = [...(fileInput.files ?? [])];
      fileInput.value = '';
      void addFiles(files.map((file) => ({ file })));
    },
  });
  const status = h('div', { class: 'status', role: 'status', hidden: true });
  const overlay = h(
    'div',
    { class: 'drop-overlay', hidden: true },
    h('div', { class: 'drop-overlay-inner' }, icon('upload', 'icon icon-xl'), 'Drop PDFs and images to add them'),
  );
  replaceChildren(root, screen, fileInput);
  document.body.append(overlay, status);

  // Dropping files anywhere adds them.
  let dragDepth = 0;
  const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
  window.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event) || busy) return;
    dragDepth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  });
  window.addEventListener('dragover', (event) => {
    if (isFileDrag(event)) event.preventDefault();
  });
  window.addEventListener('drop', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (!busy && event.dataTransfer) void filesFromDrop(event.dataTransfer).then(addFiles);
  });

  window.addEventListener('beforeunload', (event) => {
    if (project().length > 0) event.preventDefault();
  });

  document.addEventListener('keydown', onKeyDown);

  // ------------------------------------------------------------------ files

  /** Opens the system picker, which also gives access to the files on disk where supported. */
  function chooseFiles() {
    if (!canPickFiles) {
      fileInput.click();
      return;
    }
    pickFiles().then(addFiles, () => fileInput.click());
  }

  async function addFiles(picked: PickedFile[]) {
    const usable = picked.filter(({ file }) => isPdf(file) || isImage(file));
    const skipped = picked.length - usable.length;
    if (skipped > 0) toast(`${plural(skipped, 'file')} skipped. LightPDF works with PDFs and images.`);
    if (usable.length === 0) return;

    opening += usable.length;
    updateStatus();
    const results = await Promise.allSettled(usable.map(({ file, handle }) => registry.add(file, handle)));
    opening -= usable.length;
    updateStatus();

    const failures = results.flatMap((result, i) =>
      result.status === 'rejected'
        ? [`${usable[i].file.name}: ${result.reason instanceof Error ? result.reason.message : 'could not be opened.'}`]
        : [],
    );
    if (failures.length === 1) toast(failures[0]);
    else if (failures.length > 1) toast(`${failures.length} files couldn’t be opened. ${failures[0]}`);

    const docs = results.flatMap((result) =>
      result.status === 'fulfilled' ? [model.createDoc(baseName(result.value.file.name), result.value.id, result.value.pageCount)] : [],
    );
    if (docs.length === 0) return;
    if (values[DELETE_ORIGINALS] && canDeleteFiles) {
      // Deleting is switched on: ask for these files too, unless they are in a
      // folder already allowed. If the browser no longer counts the click that
      // added them, the panel offers a button.
      const handles = results.flatMap((result) => (result.status === 'fulfilled' && result.value.handle ? [result.value.handle] : []));
      void requestAccess(handles, { folder: false }).then(updateWarning);
    }
    if (project().length === 0) {
      // The first files start the history, so undo never empties the editor.
      history.reset(docs);
      afterChange();
    } else {
      commit([...project(), ...docs]);
    }
  }

  function updateStatus() {
    status.hidden = opening === 0;
    replaceChildren(status, h('span', { class: 'spinner spinner-sm' }), `Opening ${plural(opening, 'file')}…`);
  }

  // ------------------------------------------------------------------ state changes

  function commit(next: model.Project) {
    if (history.push(next)) afterChange();
  }

  function undo() {
    if (history.undo()) afterChange();
  }

  function redo() {
    if (history.redo()) afterChange();
  }

  function afterChange() {
    const keys = new Set(model.pageKeys(project()));
    selection = new Set([...selection].filter((key) => keys.has(key)));
    if (anchor && !keys.has(anchor)) anchor = undefined;
    render();
  }

  function selectedInOrder(): string[] {
    return model.pageKeys(project()).filter((key) => selection.has(key));
  }

  function deletePages(keys: Set<string>) {
    if (keys.size === 0) return;
    commit(model.deletePages(project(), keys));
    toast(`${plural(keys.size, 'page')} deleted.`, { label: 'Undo', run: undo });
  }

  function startOver() {
    if (!window.confirm('Remove all files and start over? This can’t be undone.')) return;
    registry.clear();
    history.reset([]);
    selection.clear();
    anchor = undefined;
    render();
  }

  // ------------------------------------------------------------------ rendering

  let toolbar: HTMLElement | undefined;
  let canvas: HTMLElement | undefined;
  let options: OptionsPanel | undefined;
  let summary: HTMLElement | undefined;
  let downloadButton: HTMLButtonElement | undefined;
  let saveButton: HTMLButtonElement | undefined;
  let warning: HTMLElement | undefined;
  let observer: IntersectionObserver | undefined;
  let resizer: ResizeObserver | undefined;

  function render() {
    if (project().length === 0) {
      observer?.disconnect();
      resizer?.disconnect();
      closeMenu();
      toolbar = canvas = undefined;
      replaceChildren(screen, renderLanding(chooseFiles));
      return;
    }
    if (!canvas) buildWorkspace();
    renderToolbar();
    renderCanvas();
    updateExportPanel();
  }

  function buildWorkspace() {
    toolbar = h('div', { class: 'editor-toolbar', role: 'toolbar', 'aria-label': 'Edit pages' });
    canvas = h('div', { class: 'editor-canvas' });
    resizer = new ResizeObserver(layoutCards);
    resizer.observe(canvas);
    canvas.addEventListener('click', onCanvasClick);
    canvas.addEventListener('dblclick', onCanvasDoubleClick);
    canvas.addEventListener('keydown', onCanvasKey);
    enablePageDrag(canvas, {
      keysFor: (key) => (selection.has(key) ? selectedInOrder() : [key]),
      onDrop: (keys, target) => commit(model.movePages(project(), new Set(keys), target.doc, target.position)),
      onDocDrop: (id, before) => {
        const docs = project();
        const from = docs.findIndex((doc) => doc.id === id);
        commit(model.moveDoc(docs, id, (before > from ? before - 1 : before) - from));
      },
    });

    replaceChildren(
      screen,
      h(
        'div',
        { class: 'editor' },
        toolbar,
        h('div', { class: 'editor-body' }, h('div', { class: 'editor-main' }, canvas), buildExportPanel()),
      ),
    );
  }

  function toolButton(
    label: string,
    onclick: () => void,
    { disabled = false, title = label, primary = false } = {},
  ): HTMLButtonElement {
    return h(
      'button',
      { type: 'button', class: `tool${primary ? ' tool-primary' : ''}`, title, disabled, onclick },
      primary && icon('plus', 'icon icon-sm'),
      label,
    );
  }

  function renderToolbar() {
    if (!toolbar) return;
    const docs = project();
    const count = selection.size;
    const none = count === 0;
    const group = (...children: Child[]) => h('div', { class: 'tool-group' }, children);

    replaceChildren(
      toolbar,
      group(toolButton('Add files', chooseFiles, { primary: true })),
      group(
        toolButton('Undo', undo, { disabled: !history.canUndo, title: 'Undo (Ctrl+Z)' }),
        toolButton('Redo', redo, { disabled: !history.canRedo, title: 'Redo (Ctrl+Shift+Z)' }),
      ),
      group(
        h('span', { class: 'selection-info', 'aria-live': 'polite' }, none ? 'No pages selected' : `${plural(count, 'page')} selected`),
        none
          ? toolButton('Select all', selectAll, { title: 'Select all pages (Ctrl+A)' })
          : toolButton('Clear', clearSelection, { title: 'Clear selection (Esc)' }),
      ),
      group(
        toolButton('Edit page', () => openPage(selectedInOrder()[0]), {
          disabled: count !== 1,
          title: 'Add text, drawings, images or a signature to the selected page (E, or double-click a page)',
        }),
        toolButton('Rotate left', () => commit(model.rotatePages(project(), selection, -90)), {
          disabled: none,
          title: 'Rotate selected pages left (Shift+R)',
        }),
        toolButton('Rotate right', () => commit(model.rotatePages(project(), selection, 90)), {
          disabled: none,
          title: 'Rotate selected pages right (R)',
        }),
        toolButton('Duplicate', () => commit(model.duplicatePages(project(), selection)), {
          disabled: none,
          title: 'Duplicate selected pages',
        }),
        toolButton('New file', () => commit(model.extractPages(project(), selection)), {
          disabled: none,
          title: 'Copy selected pages into a new file',
        }),
        toolButton('Delete', () => deletePages(new Set(selection)), {
          disabled: none,
          title: 'Delete selected pages (Del)',
        }),
      ),
      docs.length > 1 &&
        group(
          toolButton('Merge all', () => commit(model.mergeDocs(project())), { title: 'Merge all files into one' }),
          toolButton('Sort A–Z', () => commit(model.sortDocsByName(project())), { title: 'Sort files by name' }),
        ),
      h('div', { class: 'tool-spacer' }),
      h(
        'label',
        { class: 'zoom', title: 'Thumbnail size' },
        h('input', {
          type: 'range',
          min: ZOOM.min,
          max: ZOOM.max,
          step: 10,
          value: zoom,
          'aria-label': 'Thumbnail size',
          oninput: (event: Event) => {
            zoom = Number((event.target as HTMLInputElement).value);
            layoutCards();
            writeStorage(ZOOM_KEY, zoom);
          },
        }),
      ),
      toolButton('Start over', startOver, { title: 'Remove all files and start over' }),
    );
  }

  /**
   * Fits as many columns as the thumbnail size allows and gives each card one
   * per page, up to the full row; the grid stretches them to fill it. Rows
   * don't end in holes: a card that doesn't fit in what is left of a row takes
   * that space and wraps its pages, unless that makes it more than one row of
   * pages taller; then the row's last card widens instead, its pages keeping
   * their size.
   */
  function layoutCards() {
    if (!canvas) return;
    const docs = [...canvas.querySelectorAll<HTMLElement>('.doc')];
    const gap = parseFloat(getComputedStyle(canvas).columnGap) || 0;
    const pad = docs[0] ? parseFloat(getComputedStyle(docs[0]).paddingLeft) : 0;
    const thumb = matchMedia(CARD.narrow).matches ? CARD.narrowThumb : zoom;
    const cell = Math.max(thumb, CARD.minInner) + 2 * pad + 2;
    const cols = Math.max(1, Math.floor((canvas.clientWidth + gap) / (cell + gap)));
    canvas.style.setProperty('--cols', String(cols));
    let used = 0;
    let last: { doc: HTMLElement; span: number } | undefined;
    for (const doc of docs) {
      const pages = Number(doc.dataset.count);
      let span = Math.min(pages, cols);
      const free = cols - used;
      if (span > free) {
        if (Math.ceil(pages / free) <= Math.ceil(pages / span) + 1) span = free;
        else {
          last?.doc.style.setProperty('--span', String(last.span + free));
          used = 0;
        }
      }
      doc.style.setProperty('--span', String(span));
      used = (used + span) % cols;
      last = { doc, span };
    }
  }

  function renderCanvas() {
    if (!canvas) return;
    closeMenu();
    observer?.disconnect();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const img = entry.target as HTMLImageElement;
          io.unobserve(img);
          const page = shown.get(img.dataset.key!);
          if (!page) continue;
          thumbnail(page).then(
            (url) => (img.src = url),
            () => img.classList.add('thumb-failed'),
          );
        }
      },
      { rootMargin: '600px 0px' },
    );
    observer = io;

    const docs = project();
    shown = new Map(docs.flatMap((doc) => doc.pages.map((page) => [page.key, page] as const)));
    replaceChildren(canvas, docs.map((doc, i) => renderDoc(doc, i, docs.length)));
    layoutCards();
    canvas.querySelectorAll<HTMLImageElement>('img[data-source]:not([src])').forEach((img) => io.observe(img));
  }

  /** A page's thumbnail, with what was added in the page editor drawn over it. */
  function thumbnail(page: model.PageRef): Promise<string> {
    const plain = registry.thumbnail(page.source, page.index);
    const marks = page.marks;
    if (!marks) return plain;
    let marked = markedThumbs.get(marks);
    if (!marked) {
      // Only pages edited in the page editor need this, so it loads with it.
      marked = Promise.all([plain, registry.pageSize(page.source, page.index), import('./marks-svg')]).then(
        ([url, size, { markedThumbnail }]) => {
          const shrink = MARKED_THUMB / Math.max(size.width, size.height);
          const pixels = { width: Math.round(size.width * shrink), height: Math.round(size.height * shrink) };
          return markedThumbnail(url, pixels, size, marks);
        },
      );
      markedThumbs.set(marks, marked);
      marked.catch(() => markedThumbs.delete(marks));
    }
    return marked;
  }

  /** A thumbnail that can be shown straight away, if one is ready. */
  function readyThumbnail(page: model.PageRef): string | undefined {
    return page.marks ? undefined : registry.cachedThumbnail(page.source, page.index);
  }

  function docSelectionState(doc: model.Doc): string {
    const selected = doc.pages.filter((page) => selection.has(page.key)).length;
    return selected === 0 ? 'false' : selected === doc.pages.length ? 'true' : 'mixed';
  }

  function renderDoc(doc: model.Doc, index: number, total: number): HTMLElement {
    const action = (name: IconName, label: string, actionName: string, disabled = false) =>
      h(
        'button',
        { type: 'button', class: 'icon-button', title: label, 'aria-label': `${label}: ${doc.name}`, 'data-action': actionName, disabled },
        icon(name, 'icon icon-sm'),
      );

    return h(
      'section',
      {
        class: 'doc',
        'data-doc': doc.id,
        'data-index': index,
        'data-count': doc.pages.length,
        'aria-label': doc.name,
      },
      h(
        'header',
        { class: 'doc-header', title: total > 1 ? 'Drag to move this file' : undefined },
        h('span', { class: 'doc-grip', 'aria-hidden': 'true' }, icon('grip', 'icon icon-sm')),
        h(
          'button',
          {
            type: 'button',
            class: 'doc-check',
            role: 'checkbox',
            'aria-checked': docSelectionState(doc),
            'aria-label': `Select all pages of ${doc.name}`,
            title: 'Select all pages of this file',
            'data-action': 'doc-select',
          },
          icon('check', 'icon icon-xs'),
        ),
        h('input', {
          class: 'doc-name',
          value: doc.name,
          'aria-label': 'File name',
          title: `Rename ${doc.name}`,
          spellcheck: 'false',
          onchange: (event: Event) => commit(model.renameDoc(project(), doc.id, (event.target as HTMLInputElement).value)),
          onkeydown: (event: KeyboardEvent) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') {
              (event.target as HTMLInputElement).value = doc.name;
              (event.target as HTMLInputElement).blur();
            }
          },
        }),
        h(
          'div',
          { class: 'doc-bar' },
          h(
            'div',
            { class: 'doc-actions' },
            action('rotateRight', 'Rotate all pages', 'doc-rotate'),
            action('download', 'Download this file', 'doc-download'),
            action('trash', 'Remove this file', 'doc-delete'),
            h(
              'button',
              {
                type: 'button',
                class: 'icon-button doc-more',
                title: 'More',
                'aria-label': `More actions: ${doc.name}`,
                'aria-haspopup': 'menu',
                'aria-expanded': 'false',
                'data-action': 'doc-more',
              },
              icon('more', 'icon icon-sm'),
            ),
          ),
          h('span', { class: 'doc-meta' }, plural(doc.pages.length, 'page')),
        ),
      ),
      h('div', { class: 'doc-pages' }, doc.pages.map((page, position) => renderPage(doc, page, position))),
    );
  }

  function renderPage(doc: model.Doc, page: model.PageRef, position: number): HTMLElement {
    const source = registry.get(page.source);
    const selected = selection.has(page.key);
    const last = position === doc.pages.length - 1;
    const quick = (name: IconName, label: string, actionName: string) =>
      h('button', { type: 'button', class: 'icon-button', title: label, 'aria-label': `${label} (page ${position + 1})`, 'data-action': actionName }, icon(name, 'icon icon-sm'));

    return h(
      'div',
      {
        class: `page${selected ? ' is-selected' : ''}`,
        'data-key': page.key,
        'data-doc': doc.id,
        'data-position': position,
        tabindex: 0,
        role: 'checkbox',
        'aria-checked': String(selected),
        'aria-label': `Page ${position + 1} of ${doc.name}`,
        title: source ? `${source.file.name}${source.kind === 'pdf' ? `, page ${page.index + 1}` : ''}` : undefined,
      },
      h(
        'div',
        { class: 'page-thumb' },
        h('img', {
          class: 'thumb-img',
          alt: '',
          draggable: 'false',
          src: readyThumbnail(page),
          'data-source': page.source,
          'data-key': page.key,
          style: `--rotation:${page.rotation}deg`,
        }),
      ),
      h('span', { class: 'page-check', 'aria-hidden': 'true' }, icon('check', 'icon icon-xs')),
      h(
        'div',
        { class: 'page-quick' },
        quick('edit', 'Edit', 'page-edit'),
        quick('rotateRight', 'Rotate', 'page-rotate'),
        quick('trash', 'Delete', 'page-delete'),
      ),
      h('span', { class: 'page-grip', 'aria-hidden': 'true' }, icon('grip', 'icon icon-sm')),
      h('span', { class: 'page-number' }, String(position + 1)),
      !last &&
        h(
          'button',
          {
            type: 'button',
            class: 'split-gap',
            title: `Split the file after page ${position + 1}`,
            'aria-label': `Split ${doc.name} after page ${position + 1}`,
            'data-action': 'split-after',
          },
          icon('scissors', 'icon icon-xs'),
        ),
    );
  }

  /** Updates selection marks in place; cheaper than re-rendering every page. */
  function updateSelection() {
    canvas?.querySelectorAll<HTMLElement>('.page').forEach((card) => {
      const selected = selection.has(card.dataset.key!);
      card.classList.toggle('is-selected', selected);
      card.setAttribute('aria-checked', String(selected));
    });
    for (const doc of project()) {
      canvas?.querySelector(`.doc[data-doc="${doc.id}"] .doc-check`)?.setAttribute('aria-checked', docSelectionState(doc));
    }
    renderToolbar();
  }

  function selectAll() {
    selection = new Set(model.pageKeys(project()));
    updateSelection();
  }

  function clearSelection() {
    selection.clear();
    anchor = undefined;
    updateSelection();
  }

  function togglePage(key: string, extend: boolean) {
    if (extend && anchor) {
      for (const k of model.keyRange(project(), anchor, key)) selection.add(k);
    } else {
      if (selection.has(key)) selection.delete(key);
      else selection.add(key);
      anchor = key;
    }
    updateSelection();
  }

  // ------------------------------------------------------------------ events

  function onCanvasClick(event: MouseEvent) {
    const element = event.target as HTMLElement;
    const card = element.closest<HTMLElement>('.page');
    const docElement = element.closest<HTMLElement>('.doc');
    const button = element.closest<HTMLElement>('[data-action]');
    if (button?.dataset.action === 'doc-more') {
      toggleMenu(button, docElement!);
    } else if (button) {
      runAction(button.dataset.action!, card?.dataset.key, docElement?.dataset.doc, Number(card?.dataset.position));
    } else if (card) {
      togglePage(card.dataset.key!, event.shiftKey);
    }
  }

  function onCanvasDoubleClick(event: MouseEvent) {
    const element = event.target as HTMLElement;
    const card = element.closest<HTMLElement>('.page');
    if (card && !element.closest('button')) openPage(card.dataset.key!);
  }

  // ------------------------------------------------------------------ page editor

  /** Opens the page editor on a page; the rest of the editor waits until it closes. */
  function openPage(key: string | undefined) {
    const doc = project().find((item) => item.pages.some((page) => page.key === key));
    if (!doc || !key || busy) return;
    busy = true;
    closeMenu();
    import('./page-editor').then(
      ({ openPageEditor }) =>
        openPageEditor({
          registry,
          doc,
          pageKey: key,
          onDone: (changes) => {
            let next = project();
            for (const [pageKey, marks] of changes) next = model.setPageMarks(next, pageKey, marks);
            commit(next);
            toast(`Changes kept on ${plural(changes.size, 'page')}.`, { label: 'Undo', run: undo });
          },
          onClose: () => {
            busy = false;
            canvas?.querySelector<HTMLElement>(`.page[data-key="${key}"]`)?.focus();
          },
        }),
      (error) => {
        busy = false;
        console.error(error);
        toast('The page editor could not be opened. Check your connection and try again.');
      },
    );
  }

  // ------------------------------------------------------------------ card menu

  let closeMenu = () => {};

  /** Opens the less common file actions under a card's "More" button. */
  function toggleMenu(button: HTMLElement, card: HTMLElement) {
    const wasOpen = button.getAttribute('aria-expanded') === 'true';
    closeMenu();
    if (wasOpen) return;
    const docs = project();
    const index = docs.findIndex((doc) => doc.id === card.dataset.doc);
    const doc = docs[index];
    if (!doc) return;
    const item = (label: string, action: string, disabled: boolean) =>
      h('button', { type: 'button', class: 'menu-item', role: 'menuitem', 'data-action': action, disabled }, label);
    const menu = h(
      'div',
      { class: 'menu', role: 'menu', 'aria-label': `More actions: ${doc.name}` },
      item('Split into single pages', 'doc-explode', doc.pages.length < 2),
      item('Merge with the next file', 'doc-merge-next', index === docs.length - 1),
      item('Move left', 'doc-up', index === 0),
      item('Move right', 'doc-down', index === docs.length - 1),
    );
    menu.style.top = `${button.offsetTop + button.offsetHeight + 4}px`;
    menu.style.left = `${button.offsetLeft}px`;
    card.append(menu);
    card.classList.add('menu-open');
    button.setAttribute('aria-expanded', 'true');
    // Keep it on screen: open towards the left when it would run off the right edge.
    if (menu.getBoundingClientRect().right > document.documentElement.clientWidth - 8) {
      menu.style.left = 'auto';
      menu.style.right = `${card.clientWidth - button.offsetLeft - button.offsetWidth}px`;
    }
    const items = () => [...menu.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)')];
    items()[0]?.focus();

    const onPointer = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !button.contains(event.target as Node)) closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      const list = items();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.stopPropagation();
        closeMenu();
        button.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        list[(at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length]?.focus();
      } else if (event.key === 'Tab') {
        closeMenu();
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    menu.addEventListener('keydown', onKey);
    closeMenu = () => {
      document.removeEventListener('pointerdown', onPointer, true);
      menu.remove();
      card.classList.remove('menu-open');
      button.setAttribute('aria-expanded', 'false');
      closeMenu = () => {};
    };
  }

  function onCanvasKey(event: KeyboardEvent) {
    const card = (event.target as HTMLElement).closest<HTMLElement>('.page');
    if (card && event.target === card && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      togglePage(card.dataset.key!, event.shiftKey);
    }
  }

  function runAction(action: string, key: string | undefined, docId: string | undefined, position: number) {
    const docs = project();
    const index = docs.findIndex((doc) => doc.id === docId);
    const doc = docs[index];
    if (!doc) return;
    const docKeys = new Set(doc.pages.map((page) => page.key));

    switch (action) {
      case 'page-edit':
        return openPage(key);
      case 'page-rotate':
        return commit(model.rotatePages(docs, new Set([key!]), 90));
      case 'page-delete':
        return deletePages(new Set([key!]));
      case 'split-after':
        return commit(model.splitDoc(docs, doc.id, position));
      case 'doc-select': {
        const all = docSelectionState(doc) === 'true';
        docKeys.forEach((k) => (all ? selection.delete(k) : selection.add(k)));
        return updateSelection();
      }
      case 'doc-rotate':
        return commit(model.rotatePages(docs, docKeys, 90));
      case 'doc-explode':
        return commit(model.splitIntoPages(docs, doc.id));
      case 'doc-merge-next':
        return commit(model.mergeDocs(docs, new Set([doc.id, docs[index + 1]?.id])));
      case 'doc-up':
        return commit(model.moveDoc(docs, doc.id, -1));
      case 'doc-down':
        return commit(model.moveDoc(docs, doc.id, 1));
      case 'doc-download':
        return void runExport([doc], 'download');
      case 'doc-delete':
        commit(model.removeDoc(docs, doc.id));
        return toast(`Removed ${doc.name}.`, { label: 'Undo', run: undo });
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!canvas || busy || isTyping(event.target) || document.querySelector('.dialog-backdrop')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => event.preventDefault();

    if (mod && key === 'z') {
      handled();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') {
      handled();
      redo();
    } else if (mod && key === 'a') {
      handled();
      selectAll();
    } else if (!mod && (event.key === 'Delete' || event.key === 'Backspace') && selection.size > 0) {
      handled();
      deletePages(new Set(selection));
    } else if (event.key === 'Escape' && selection.size > 0) {
      clearSelection();
    } else if (!mod && !event.altKey && key === 'r' && selection.size > 0) {
      handled();
      commit(model.rotatePages(project(), selection, event.shiftKey ? -90 : 90));
    } else if (!mod && !event.altKey && key === 'e') {
      const focused = (event.target as HTMLElement).closest?.<HTMLElement>('.page');
      const pageKey = focused?.dataset.key ?? (selection.size === 1 ? selectedInOrder()[0] : undefined);
      if (pageKey) {
        handled();
        openPage(pageKey);
      }
    }
  }

  // ------------------------------------------------------------------ export

  function hasImages(): boolean {
    return project().some((doc) => doc.pages.some((page) => registry.get(page.source)?.kind === 'image'));
  }

  function buildExportPanel(): HTMLElement {
    values[HAS_IMAGES] = hasImages();
    let deleting = Boolean(values[DELETE_ORIGINALS]);
    options = renderOptions(EXPORT_FIELDS, values, () => {
      if (values[DELETE_ORIGINALS] && !deleting) {
        // Ask now, while ticking the box still counts as a click; the files
        // are only deleted after saving. Several files: once, for their folder.
        void requestAccess(originalsOf(project()).handles).then(updateWarning);
      }
      deleting = Boolean(values[DELETE_ORIGINALS]);
      const remembered = Object.entries(values).filter(([key]) => key !== HAS_IMAGES && key !== DELETE_ORIGINALS);
      writeStorage(SETTINGS_KEY, Object.fromEntries(remembered));
      updateExportPanel();
    });
    summary = h('p', { class: 'export-summary' });
    warning = h('div', { class: 'export-warning', role: 'status', hidden: true });
    downloadButton = h('button', { type: 'button', class: 'btn btn-primary btn-action', onclick: () => void runExport(project(), 'download') });
    saveButton = canSaveAs
      ? h('button', { type: 'button', class: 'btn btn-light btn-save', onclick: () => void runExport(project(), 'save') }, 'Save as…')
      : undefined;
    return h(
      'aside',
      { class: 'sidebar', 'aria-label': 'Download options' },
      h('h2', { class: 'sidebar-title' }, 'Download'),
      h('div', { class: 'sidebar-body' }, options.element),
      h('div', { class: 'sidebar-footer' }, summary, warning, h('div', { class: 'export-buttons' }, downloadButton, saveButton)),
    );
  }

  function updateExportPanel() {
    if (!options || !summary || !downloadButton) return;
    values[HAS_IMAGES] = hasImages();
    options.refresh();

    const docs = project().length;
    const pages = model.pageCount(project());
    const format = values.format;
    const outputs = format === 'jpg' || format === 'png' ? pages : docs;
    const label =
      format === 'pdf'
        ? docs === 1 ? 'Download PDF' : `Download ${docs} PDFs`
        : format === 'txt'
          ? docs === 1 ? 'Download text' : `Download ${docs} text files`
          : pages === 1 ? 'Download image' : `Download ${pages} images`;
    summary.textContent = `${plural(docs, 'file')} · ${plural(pages, 'page')}${outputs > 1 ? ' · downloads as a ZIP' : ''}`;
    downloadButton.textContent = label;
    if (saveButton) saveButton.title = outputs > 1 ? 'Choose a folder to save the files in' : 'Choose where to save the file';
    void updateWarning();
  }

  let warningToken = 0;

  /** Explains what will be deleted, and offers to grant any missing permission. */
  async function updateWarning() {
    if (!warning) return;
    const token = ++warningToken;
    if (!values[DELETE_ORIGINALS]) {
      warning.hidden = true;
      return;
    }
    const { handles, missing } = originalsOf(project());
    const pending = await lacksWriteAccess(handles);
    if (token !== warningToken || !warning) return;

    const parts: Child[] = [h('p', {}, 'The files you added will be deleted from your computer after saving or downloading.')];
    if (pending.length) {
      parts.push(
        h(
          'p',
          {},
          `${pending.length === handles.length ? 'Your browser needs your permission first.' : `${plural(pending.length, 'file')} still need${pending.length === 1 ? 's' : ''} your permission.`} `,
          h(
            'button',
            {
              type: 'button',
              class: 'warning-action',
              onclick: () => void requestWriteAccess(pending).then(updateWarning),
            },
            'Allow',
          ),
        ),
      );
    }
    if (missing.length) parts.push(h('p', {}, `${listNames(missing)} can’t be deleted: added without access to the file on disk.`));
    replaceChildren(warning, parts);
    warning.hidden = false;
  }

  /** The disk files behind the documents being exported. */
  function originalsOf(docs: readonly model.Doc[]): Pick<Cleanup, 'handles' | 'missing'> {
    const handles: FileSystemFileHandle[] = [];
    const missing: string[] = [];
    for (const id of new Set(docs.flatMap((doc) => doc.pages.map((page) => page.source)))) {
      const source = registry.get(id);
      if (source?.handle) handles.push(source.handle);
      else if (source && !source.deleted) missing.push(source.file.name);
    }
    return { handles, missing };
  }

  function describeDeletion(result: DeleteResult, askedForPermission: boolean, pending: FileSystemFileHandle[]): string[] {
    const lines: string[] = [];
    if (result.deleted.length) lines.push(`Deleted ${listNames(result.deleted)} from your computer.`);
    for (const { name, reason } of result.kept) lines.push(`Kept ${name}: ${reason}.`);
    if (askedForPermission && pending.length) lines.push(`Kept ${listNames(pending.map((handle) => handle.name))}: permission wasn’t given.`);
    return lines;
  }

  /** Deletes the originals that may be deleted, then shows the result and anything still to do. */
  async function showResult(dialog: ProgressDialog, view: DialogState, cleanup?: Cleanup) {
    if (!cleanup) return dialog.show(view);
    const lines = [...(view.lines ?? [])];
    let pending = cleanup.handles;
    if (pending.length) {
      const result = await deleteFiles(pending, cleanup.written, false);
      registry.forgetHandles(result.removed);
      lines.push(...describeDeletion(result, false, []));
      if (cleanup.afterDownload && result.deleted.length) {
        lines.push('If the download didn’t finish, use Download again before closing this tab; LightPDF still has the files.');
      }
      pending = result.needPermission;
    }
    if (cleanup.missing.length) {
      lines.push(`Can’t delete ${listNames(cleanup.missing)}: added without access to the file on disk.`);
    }
    void updateWarning();
    if (pending.length === 0) return dialog.show({ ...view, lines });

    const names = listNames(pending.map((handle) => handle.name));
    const deleteAction: DialogAction = {
      label: `Delete ${plural(pending.length, 'original')}`,
      primary: true,
      run: async () => {
        const result = await deleteFiles(pending, cleanup.written, true);
        registry.forgetHandles(result.removed);
        void updateWarning();
        dialog.show({ ...view, lines: [...lines, ...describeDeletion(result, true, result.needPermission)] });
      },
    };
    dialog.show({
      ...view,
      lines: [...lines, `To delete ${names}, allow LightPDF to change them.`],
      actions: [...view.actions.map((action) => ({ ...action, primary: false })), deleteAction],
    });
  }

  async function runExport(docs: readonly model.Doc[], delivery: 'download' | 'save') {
    if (busy || docs.length === 0) return;
    const settings = toExportSettings(values);

    // The save dialog has to open straight from the click, before any slow work.
    let destination: Destination | null = null;
    if (delivery === 'save') {
      try {
        destination = await chooseDestination(docs.flatMap((doc) => outputNames(doc, settings.format)));
      } catch {
        toast('Your browser couldn’t open the save dialog. Use Download instead.');
        return;
      }
      if (!destination) return;
    }

    busy = true;
    let cancelled = false;
    const dialog = progressDialog(delivery === 'save' ? 'Saving' : 'Preparing your download', () => {
      cancelled = true;
      dialog.close();
    });
    const back: DialogAction = { label: 'Back to editor', run: dialog.close, primary: true };
    const originals = values[DELETE_ORIGINALS] && canDeleteFiles ? originalsOf(docs) : undefined;

    try {
      const result = await exportDocs(docs, registry, settings, (fraction, label) => {
        if (cancelled) throw new Cancelled();
        dialog.update(fraction, label);
      });
      if (cancelled) return;

      if (destination) {
        dialog.update(1, 'Writing files');
        const written = await writeOutputs(destination, result.files);
        const where =
          destination.kind === 'folder'
            ? `${plural(written.length, 'file')} saved in the folder ${destination.handle.name}.`
            : `Saved as ${written[0].name}.`;
        await showResult(
          dialog,
          { title: 'Saved', tone: 'done', lines: [where, result.summary], actions: [back] },
          originals && { ...originals, written, afterDownload: false },
        );
      } else {
        const zipName = `${docs.length === 1 ? safeFileName(docs[0].name) : 'lightpdf'}.zip`;
        const file = result.files.length === 1 ? result.files[0] : await zipOutputs(result.files, zipName);
        download(file);
        await showResult(
          dialog,
          {
            title: 'Your download has started',
            tone: 'done',
            lines: [`${file.name} · ${formatBytes(file.blob.size)}`, result.summary],
            actions: [{ label: 'Download again', run: () => download(file) }, back],
          },
          originals && { ...originals, written: [], afterDownload: true },
        );
      }
    } catch (error) {
      if (!(error instanceof Cancelled) && !cancelled) {
        console.error(error);
        dialog.show({
          title: 'That didn’t work',
          tone: 'error',
          lines: [error instanceof Error ? error.message : 'Something went wrong. Please try again.'],
          actions: [back],
        });
      }
    } finally {
      busy = false;
    }
  }

  render();
}
