import { download, formatBytes, isImage, isPdf, zipOutputs, type OutputFile } from '../browser/files';
import { normalizeAngle } from '../core/angle';
import { TOOLS } from '../tools';
import { percent } from '../tools/helpers';
import type { InputFile, RunResult, Tool } from '../tools/types';
import { h, replaceChildren } from './dom';
import { icon } from './icons';
import { defaultValues, renderOptions, type OptionsPanel } from './options';
import { makeSortable, moveItem } from './sortable';
import { cachedPageThumbnail, fileInfo, renderPageThumbnails, type FileInfo } from './thumbnails';
import { toast } from './toast';

interface Entry {
  id: number;
  file: File;
  info?: FileInfo;
  error?: string;
  loaded: Promise<void>;
}

interface PageEntry {
  /** Stable identity, so duplicated pages can be told apart. */
  key: number;
  index: number;
  rotation: number;
}

let nextId = 1;
let handoff: File[] | undefined;

/** Files to open in the next tool page that mounts ("Continue to…"). */
export function handOff(files: File[]): void {
  handoff = files;
}

/** Renders a tool page into `root`. Returns a function that tears it down. */
export function mountTool(root: HTMLElement, tool: Tool): () => void {
  const values = defaultValues(tool.fields ?? []);
  const noun = tool.accepts === 'pdf' ? (tool.multiple ? 'PDF files' : 'PDF file') : 'images';
  let entries: Entry[] = [];
  let pages: PageEntry[] = [];
  let pageThumbsFor: number | undefined;
  let stopPageThumbs: (() => void) | undefined;
  let busy = false;

  // Elements of the workspace screen, set by showWorkspace().
  let main: HTMLElement | undefined;
  let options: OptionsPanel | undefined;
  let actionButton: HTMLButtonElement | undefined;
  let actionHint: HTMLElement | undefined;
  let errorBox: HTMLElement | undefined;

  const screen = h('div', { class: 'tool-screen' });
  const fileInput = h('input', {
    type: 'file',
    hidden: true,
    multiple: tool.multiple,
    accept: tool.accepts === 'pdf' ? 'application/pdf,.pdf' : 'image/*',
    onchange: () => {
      const files = [...(fileInput.files ?? [])];
      fileInput.value = '';
      if (files.length) void addFiles(files);
    },
  });
  const overlay = h(
    'div',
    { class: 'drop-overlay', hidden: true },
    h('div', { class: 'drop-overlay-inner' }, icon('upload', 'icon icon-xl'), `Drop your ${noun} here`),
  );
  replaceChildren(root, screen, fileInput);
  document.body.append(overlay);

  // Dropping files anywhere on the page adds them.
  let dragDepth = 0;
  const isFileDrag = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'));
  const onDragEnter = (event: DragEvent) => {
    if (!isFileDrag(event) || busy) return;
    dragDepth++;
    overlay.hidden = false;
  };
  const onDragLeave = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) overlay.hidden = true;
  };
  const onDragOver = (event: DragEvent) => {
    if (isFileDrag(event)) event.preventDefault();
  };
  const onDrop = (event: DragEvent) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    overlay.hidden = true;
    if (!busy) void addFiles([...(event.dataTransfer?.files ?? [])]);
  };
  window.addEventListener('dragenter', onDragEnter);
  window.addEventListener('dragleave', onDragLeave);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  const inputs = (): InputFile[] => entries.map((entry) => ({ file: entry.file, pageCount: entry.info?.pageCount }));

  // ---------------------------------------------------------------- files

  function createEntry(file: File): Entry {
    const entry = { id: nextId++, file } as Entry;
    entry.loaded = fileInfo(file).then(
      (info) => {
        entry.info = info;
      },
      (error: unknown) => {
        entry.error = error instanceof Error ? error.message : 'This file could not be opened.';
      },
    );
    void entry.loaded.then(() => onEntryLoaded(entry));
    return entry;
  }

  async function addFiles(files: File[]) {
    const accepted = files.filter((file) => (tool.accepts === 'pdf' ? isPdf(file) : isImage(file)));
    const skipped = files.length - accepted.length;
    const kind = tool.accepts === 'pdf' ? 'PDF files' : 'images';
    if (accepted.length === 0) {
      toast(`${tool.title} only works with ${kind}.`);
      return;
    }
    if (skipped > 0) toast(`${skipped} file${skipped > 1 ? 's were' : ' was'} skipped. ${tool.title} only works with ${kind}.`);
    if (!tool.multiple && accepted.length > 1) toast(`${tool.title} works on one file at a time, so only the first was added.`);

    const added = (tool.multiple ? accepted : accepted.slice(0, 1)).map(createEntry);
    entries = tool.multiple ? [...entries, ...added] : added;

    if (tool.initialValues || tool.pageEditor) {
      showLoading();
      await Promise.all(entries.map((entry) => entry.loaded));
      const ready = entries.filter((entry) => !entry.error);
      if (tool.initialValues && ready.length === entries.length) {
        Object.assign(values, await tool.initialValues(inputs()));
      }
      if (tool.pageEditor) resetPages();
    }
    showWorkspace();
  }

  function removeEntry(entry: Entry) {
    entries = entries.filter((other) => other !== entry);
    if (entries.length === 0) showSelect();
    else {
      renderMain();
      updateAction();
    }
  }

  function onEntryLoaded(entry: Entry) {
    const card = main?.querySelector(`[data-entry="${entry.id}"]`);
    if (card && entries.includes(entry)) card.replaceWith(renderFileCard(entry));
    options?.refresh();
    updateAction();
  }

  // ---------------------------------------------------------------- screens

  function showSelect() {
    busy = false;
    entries = [];
    pages = [];
    main = undefined;
    replaceChildren(
      screen,
      h(
        'section',
        { class: 'upload' },
        h('h1', { class: 'upload-title' }, tool.title),
        h('p', { class: 'upload-lead' }, tool.heading),
        h('button', { type: 'button', class: 'btn btn-primary btn-select', onclick: () => fileInput.click() }, `Select ${noun}`),
        h('p', { class: 'upload-hint' }, `or drop ${noun} here`),
        h(
          'p',
          { class: 'upload-privacy' },
          icon('shield', 'icon icon-sm'),
          'Your files never leave this device. Everything is processed in your browser.',
        ),
      ),
    );
  }

  function showLoading() {
    busy = true;
    replaceChildren(screen, h('section', { class: 'processing' }, h('div', { class: 'spinner spinner-lg' }), h('h2', {}, 'Reading your file…')));
  }

  function showWorkspace(error?: string) {
    busy = false;
    main = h('div', { class: 'workspace-main' });
    options = renderOptions(tool.fields ?? [], values, inputs, onValuesChanged);
    actionHint = h('p', { class: 'action-hint' });
    errorBox = h('div', { class: 'sidebar-error', role: 'alert', hidden: !error }, error ?? '');
    actionButton = h(
      'button',
      { type: 'button', class: 'btn btn-primary btn-action', onclick: run },
      tool.action,
      icon('arrowRight'),
    );

    const sidebar = h(
      'aside',
      { class: 'sidebar' },
      h('h2', { class: 'sidebar-title' }, tool.title),
      h(
        'div',
        { class: 'sidebar-body' },
        (tool.tips ?? []).map((tip) => h('p', { class: 'tip' }, tip)),
        tool.pageEditor && renderPageTools(),
        options.element,
        errorBox,
      ),
      h('div', { class: 'sidebar-footer' }, actionHint, actionButton),
    );
    replaceChildren(screen, h('div', { class: 'workspace' }, main, sidebar));
    renderMain();
    updateAction();
  }

  function renderMain() {
    if (!main) return;
    if (tool.pageEditor && entries[0] && !entries[0].error) {
      renderPageEditor(main);
      return;
    }

    const count = entries.length;
    const label = `${count} ${tool.accepts === 'pdf' ? 'PDF' : 'image'}${count === 1 ? '' : 's'}`;
    const grid = h('div', { class: 'file-grid' }, entries.map(renderFileCard));
    if (tool.ordered && count > 1) {
      makeSortable(grid, '.file-card', (from, to) => {
        entries = moveItem(entries, from, to);
        renderMain();
      });
    }

    replaceChildren(
      main,
      h(
        'div',
        { class: 'main-toolbar' },
        h('span', { class: 'file-count' }, label),
        h(
          'div',
          { class: 'toolbar-actions' },
          tool.ordered &&
            count > 1 &&
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-light',
                title: 'Sort by file name',
                onclick: () => {
                  entries = [...entries].sort((a, b) =>
                    a.file.name.localeCompare(b.file.name, undefined, { numeric: true }),
                  );
                  renderMain();
                },
              },
              icon('sort', 'icon icon-sm'),
              'Sort A–Z',
            ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn-add',
              title: tool.multiple ? `Add more ${noun}` : `Choose a different ${noun}`,
              'aria-label': tool.multiple ? `Add more ${noun}` : `Choose a different ${noun}`,
              onclick: () => fileInput.click(),
            },
            icon(tool.multiple ? 'plus' : 'upload'),
            tool.multiple && h('span', { class: 'badge' }, String(count)),
          ),
        ),
      ),
      grid,
    );
  }

  function renderFileCard(entry: Entry): HTMLElement {
    const rotation = tool.previewRotation?.(values) ?? 0;
    const draggable = tool.ordered && entries.length > 1;
    const meta = [
      entry.info?.pageCount !== undefined && `${entry.info.pageCount} page${entry.info.pageCount === 1 ? '' : 's'}`,
      formatBytes(entry.file.size),
    ]
      .filter(Boolean)
      .join(' · ');

    let thumb: HTMLElement;
    if (entry.error) {
      thumb = h('div', { class: 'thumb-error' }, icon(/password/i.test(entry.error) ? 'lock' : 'alert'), entry.error);
    } else if (entry.info) {
      thumb = h('img', { src: entry.info.thumbnail, alt: '', class: 'thumb-img', style: `--rotation:${rotation}deg` });
    } else {
      thumb = h('div', { class: 'spinner' });
    }

    return h(
      'div',
      { class: `file-card${entry.error ? ' has-error' : ''}${draggable ? ' is-draggable' : ''}`, 'data-entry': entry.id, draggable: draggable ? 'true' : undefined },
      h(
        'button',
        { type: 'button', class: 'card-button card-remove', title: 'Remove', 'aria-label': `Remove ${entry.file.name}`, onclick: () => removeEntry(entry) },
        icon('close', 'icon icon-sm'),
      ),
      h('div', { class: 'file-thumb' }, thumb),
      h('div', { class: 'file-name', title: entry.file.name }, entry.file.name),
      h('div', { class: 'file-meta' }, meta),
    );
  }

  function onValuesChanged() {
    if (errorBox) errorBox.hidden = true;
    if (tool.previewRotation && main) {
      const rotation = tool.previewRotation(values);
      main.querySelectorAll<HTMLElement>('.thumb-img').forEach((img) => img.style.setProperty('--rotation', `${rotation}deg`));
    }
  }

  function updateAction() {
    if (!actionButton || !actionHint) return;
    const min = tool.minFiles ?? 1;
    const loading = entries.some((entry) => !entry.info && !entry.error);
    let hint = '';
    if (entries.length < min) hint = `Add at least ${min} ${tool.accepts === 'pdf' ? 'PDF files' : 'images'} to continue.`;
    else if (entries.some((entry) => entry.error)) hint = 'Remove the files that can’t be opened to continue.';
    else if (tool.pageEditor && pages.length === 0) hint = 'Every page has been deleted. Reset to start again.';
    actionHint.textContent = hint;
    actionHint.hidden = !hint;
    actionButton.disabled = Boolean(hint) || loading;
  }

  // ---------------------------------------------------------------- page editor

  function resetPages() {
    const count = entries[0]?.info?.pageCount ?? 0;
    pages = Array.from({ length: count }, (_, index) => ({ key: nextId++, index, rotation: 0 }));
  }

  function renderPageTools(): HTMLElement {
    const rotateAll = (delta: number) => {
      pages = pages.map((page) => ({ ...page, rotation: normalizeAngle(page.rotation + delta) }));
      renderMain();
    };
    return h(
      'div',
      { class: 'page-tools' },
      h('button', { type: 'button', class: 'btn btn-light', onclick: () => rotateAll(-90) }, icon('rotateLeft', 'icon icon-sm'), 'Rotate all left'),
      h('button', { type: 'button', class: 'btn btn-light', onclick: () => rotateAll(90) }, icon('rotateRight', 'icon icon-sm'), 'Rotate all right'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-light',
          onclick: () => {
            resetPages();
            renderMain();
            updateAction();
          },
        },
        'Reset',
      ),
    );
  }

  function renderPageEditor(container: HTMLElement) {
    const entry = entries[0];
    const grid = h('div', { class: 'page-grid' }, pages.map((page, position) => renderPageCard(entry, page, position)));
    makeSortable(grid, '.page-card', (from, to) => {
      pages = moveItem(pages, from, to);
      renderMain();
    });

    replaceChildren(
      container,
      h(
        'div',
        { class: 'main-toolbar' },
        h('span', { class: 'file-count', title: entry.file.name }, `${entry.file.name} · ${pages.length} page${pages.length === 1 ? '' : 's'}`),
        h(
          'div',
          { class: 'toolbar-actions' },
          h(
            'button',
            { type: 'button', class: 'btn-add', title: 'Choose a different PDF', 'aria-label': 'Choose a different PDF', onclick: () => fileInput.click() },
            icon('upload'),
          ),
        ),
      ),
      grid,
    );

    if (pageThumbsFor !== entry.id) {
      stopPageThumbs?.();
      pageThumbsFor = entry.id;
      stopPageThumbs = renderPageThumbnails(entry.file, (index, url) => {
        main?.querySelectorAll<HTMLImageElement>(`.page-card[data-page-index="${index}"] img`).forEach((img) => {
          img.src = url;
        });
      });
    }
  }

  function renderPageCard(entry: Entry, page: PageEntry, position: number): HTMLElement {
    const update = (next: PageEntry[]) => {
      pages = next;
      renderMain();
      updateAction();
    };
    const rotateBy = (delta: number) =>
      update(pages.map((other) => (other.key === page.key ? { ...other, rotation: normalizeAngle(other.rotation + delta) } : other)));
    const action = (name: Parameters<typeof icon>[0], label: string, onclick: () => void) =>
      h('button', { type: 'button', class: 'card-button', title: label, 'aria-label': `${label} (page ${position + 1})`, onclick }, icon(name, 'icon icon-sm'));

    const src = cachedPageThumbnail(entry.file, page.index);
    return h(
      'div',
      { class: 'page-card', draggable: 'true', 'data-page-index': page.index },
      h(
        'div',
        { class: 'page-actions' },
        action('rotateLeft', 'Rotate left', () => rotateBy(-90)),
        action('rotateRight', 'Rotate right', () => rotateBy(90)),
        action('copy', 'Duplicate', () => {
          const copy = { ...page, key: nextId++ };
          const next = [...pages];
          next.splice(position + 1, 0, copy);
          update(next);
        }),
        action('trash', 'Delete', () => update(pages.filter((other) => other.key !== page.key))),
      ),
      h('div', { class: 'page-thumb' }, h('img', { src, alt: `Page ${page.index + 1}`, class: 'thumb-img', style: `--rotation:${page.rotation}deg` })),
      h('div', { class: 'page-number' }, String(position + 1)),
    );
  }

  // ---------------------------------------------------------------- run

  async function run() {
    if (!actionButton || actionButton.disabled) return;
    busy = true;
    const bar = h('div', { class: 'progress-bar' });
    const label = h('p', { class: 'progress-label' }, '0%');
    replaceChildren(
      screen,
      h(
        'section',
        { class: 'processing' },
        h('h2', {}, `${tool.working}…`),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': tool.working }, bar),
        label,
        h('p', { class: 'muted' }, 'Working on your device. Nothing is uploaded.'),
      ),
    );

    try {
      const result = await tool.run({
        inputs: inputs(),
        values: { ...values },
        pages: pages.map(({ index, rotation }) => ({ index, rotation })),
        onProgress: (fraction) => {
          const clamped = Math.min(1, Math.max(0, fraction));
          bar.style.width = percent(clamped);
          label.textContent = percent(clamped);
        },
      });
      await showDone(result);
    } catch (error) {
      console.error(error);
      showWorkspace(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    }
  }

  async function showDone(result: RunResult) {
    const outputs = result.files;
    const file: OutputFile =
      outputs.length === 1 ? outputs[0] : await zipOutputs(outputs, result.zipName ?? 'lightpdf.zip');
    const isZip = outputs.length > 1;
    const isPdfOutput = !isZip && file.blob.type === 'application/pdf';
    const label = isZip
      ? `Download ${outputs.length} files`
      : isPdfOutput
        ? 'Download PDF'
        : file.blob.type.startsWith('image/')
          ? 'Download image'
          : 'Download file';

    const continueTools = isPdfOutput ? TOOLS.filter((other) => other.accepts === 'pdf' && other.id !== tool.id) : [];

    replaceChildren(
      screen,
      h(
        'section',
        { class: 'done' },
        h('h1', {}, tool.done),
        h(
          'div',
          { class: 'done-actions' },
          h(
            'button',
            { type: 'button', class: 'btn-round', title: 'Back to options', 'aria-label': 'Back to options', onclick: () => showWorkspace() },
            icon('arrowLeft'),
          ),
          h('button', { type: 'button', class: 'btn btn-primary btn-download', onclick: () => download(file) }, icon('download'), label),
        ),
        h('p', { class: 'done-file' }, `${file.name} · ${formatBytes(file.blob.size)}${isZip ? ' (ZIP)' : ''}`),
        result.summary && h('p', { class: 'done-summary' }, result.summary),
        continueTools.length > 0 &&
          h(
            'div',
            { class: 'continue' },
            h('h3', {}, 'Continue with this file'),
            h(
              'div',
              { class: 'continue-list' },
              continueTools.map((next) =>
                h(
                  'a',
                  {
                    class: 'continue-chip',
                    href: `#/${next.id}`,
                    style: `--tool-color:${next.color}`,
                    onclick: () => handOff([new File([file.blob], file.name, { type: file.blob.type })]),
                  },
                  icon(next.icon, 'icon icon-sm'),
                  next.title,
                ),
              ),
            ),
          ),
        h('button', { type: 'button', class: 'link-button', onclick: () => showSelect() }, `Start over with new ${noun}`),
      ),
    );
    busy = false;
  }

  showSelect();
  if (handoff) {
    const files = handoff;
    handoff = undefined;
    void addFiles(files);
  }

  return () => {
    stopPageThumbs?.();
    overlay.remove();
    window.removeEventListener('dragenter', onDragEnter);
    window.removeEventListener('dragleave', onDragLeave);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
