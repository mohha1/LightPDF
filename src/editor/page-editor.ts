import { prepareImage } from '../browser/files';
import {
  FONTS,
  LINE_HEIGHT,
  markBounds,
  moveMark,
  normalizeRect,
  PageView,
  placeIn,
  quarterTurn,
  resizeMark,
  textLines,
  type FontName,
  type LineMark,
  type Mark,
  type MarkImage,
  type Point,
  type Rect,
  type TextMark,
} from '../core/marks';
import { h, replaceChildren, type Child } from '../ui/dom';
import { toast } from '../ui/toast';
import { History } from './history';
import { renderMarks, svg } from './marks-svg';
import type { Doc } from './model';
import type { SourceRegistry } from './sources';

type Tool = 'select' | 'text' | 'draw' | 'highlight' | 'whiteout' | 'rect' | 'ellipse' | 'line' | 'arrow';
type Action = 'image' | 'signature';

interface ToolInfo {
  id: Tool | Action;
  label: string;
  key: string;
  hint: string;
}

const TOOLS: ToolInfo[] = [
  { id: 'select', label: 'Select', key: 'v', hint: 'Click something you added to move or resize it. Double-click text to change it.' },
  { id: 'text', label: 'Text', key: 't', hint: 'Click where the text goes, then type.' },
  { id: 'draw', label: 'Draw', key: 'd', hint: 'Draw freehand on the page.' },
  { id: 'highlight', label: 'Highlight', key: 'h', hint: 'Drag across what you want to highlight.' },
  { id: 'whiteout', label: 'Whiteout', key: 'w', hint: 'Drag over what you want to cover. It is covered, not removed: the text underneath can still be copied.' },
  { id: 'rect', label: 'Rectangle', key: 'r', hint: 'Drag to draw a rectangle. Shift draws a square.' },
  { id: 'ellipse', label: 'Ellipse', key: 'e', hint: 'Drag to draw an ellipse. Shift draws a circle.' },
  { id: 'line', label: 'Line', key: 'l', hint: 'Drag to draw a line. Shift keeps it at 45° steps.' },
  { id: 'arrow', label: 'Arrow', key: 'a', hint: 'Drag from the tail to the point. Shift keeps it at 45° steps.' },
  { id: 'image', label: 'Image', key: 'i', hint: '' },
  { id: 'signature', label: 'Signature', key: 's', hint: '' },
];

const COLORS = ['#111111', '#ffffff', '#d92d20', '#1f5fd1', '#1b8a3c', '#f5b400'];
const HIGHLIGHTS = ['#ffe14d', '#9ef09e', '#ffadd6', '#9fd3ff', '#ffc078'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72];
const WIDTHS = [1, 2, 3, 4, 6, 8, 12];
/** CSS pixels per point at 100%. */
const ACTUAL = 96 / 72;
const ZOOM = { min: 0.25, max: 4, step: 1.25 };

/** The look of new marks; changed from the bar while drawing. Kept for the visit only. */
const style = {
  text: { font: 'sans' as FontName, size: 14, bold: false, color: '#111111' },
  ink: { color: '#111111', lineWidth: 2 },
  line: { color: '#111111', lineWidth: 2 },
  shape: { color: '#111111', lineWidth: 2, filled: false },
  whiteout: { color: '#ffffff' },
  highlight: { color: '#ffe14d' },
};
type StyleKind = keyof typeof style;

/** A signature drawn during this visit, offered again; never stored. */
let lastSignature: { image: MarkImage; width: number; height: number } | undefined;

let counter = 0;
const newId = () => `m${++counter}`;

function styleKind(of: Tool | Mark['type']): StyleKind | undefined {
  switch (of) {
    case 'text':
      return 'text';
    case 'draw':
    case 'ink':
      return 'ink';
    case 'line':
    case 'arrow':
      return 'line';
    case 'rect':
    case 'ellipse':
      return 'shape';
    case 'whiteout':
    case 'highlight':
      return of;
    default:
      return undefined;
  }
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Sets a text mark's box to the size of its text. */
function fitText(mark: TextMark): TextMark {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const lines = textLines(mark.text);
  let width = 0;
  if (measureContext) {
    measureContext.font = `${mark.bold ? 700 : 400} ${mark.size}px ${FONTS[mark.font].css}`;
    for (const line of lines) width = Math.max(width, measureContext.measureText(line).width);
  } else {
    width = Math.max(...lines.map((line) => line.length)) * mark.size * 0.55;
  }
  return { ...mark, width: Math.max(width, mark.size * 0.5), height: lines.length * mark.size * LINE_HEIGHT };
}

export interface PageEditorOptions {
  registry: SourceRegistry;
  doc: Doc;
  /** The page to open first. */
  pageKey: string;
  /** Called with the new marks of each page that changed, when the person clicks Done. */
  onDone(changes: Map<string, readonly Mark[]>): void;
  onClose(): void;
}

/**
 * A full-screen editor for one page at a time: add text, freehand drawing,
 * highlights, whiteout, shapes, lines, images and a signature. Changes stay
 * in drafts until Done, so Cancel leaves the document as it was.
 */
export function openPageEditor({ registry, doc, pageKey, onDone, onClose }: PageEditorOptions): void {
  const drafts = new Map<string, History<readonly Mark[]>>();
  let position = Math.max(0, doc.pages.findIndex((page) => page.key === pageKey));
  let view = new PageView({ width: 612, height: 792 }, 0);
  let scale = ACTUAL;
  let fitting = true;
  /** Set once the first page's size is known; until then there is nothing to lay out. */
  let loaded = false;
  let tool: Tool = 'select';
  let selected: string | undefined;
  /** Marks shown while a gesture is under way, before it becomes one undo step. */
  let live: readonly Mark[] | undefined;
  let editing: { mark: TextMark; created: boolean; box: HTMLTextAreaElement } | undefined;
  let loadToken = 0;

  const page = () => doc.pages[position];
  const history = () => {
    let draft = drafts.get(page().key);
    if (!draft) {
      draft = new History<readonly Mark[]>(page().marks ?? []);
      drafts.set(page().key, draft);
    }
    return draft;
  };
  const marks = () => live ?? history().present;
  const selectedMark = () => marks().find((mark) => mark.id === selected);

  // ------------------------------------------------------------------ layout

  const bar = h('div', { class: 'pe-bar', role: 'toolbar', 'aria-label': 'Page editor' });
  const tools = h('div', { class: 'pe-tools', role: 'toolbar', 'aria-label': 'Tools' });
  const props = h('div', { class: 'pe-props' });
  const overlay = svg('svg', { class: 'pe-overlay' });
  const sheet = h('div', { class: 'pe-sheet' }, overlay);
  const stage = h('div', { class: 'pe-stage' }, sheet);
  const imageInput = h('input', {
    type: 'file',
    hidden: true,
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp',
    onchange: () => {
      const file = imageInput.files?.[0];
      imageInput.value = '';
      if (file) void addImage(file);
    },
  });
  const root = h(
    'div',
    { class: 'page-editor', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Edit page: ${doc.name}`, tabindex: -1 },
    bar,
    tools,
    props,
    stage,
    imageInput,
  );
  const opener = document.activeElement as HTMLElement | null;
  document.body.append(root);
  document.body.classList.add('page-editor-open');
  root.focus();

  const resizer = new ResizeObserver(() => {
    if (fitting && loaded) fit();
  });
  resizer.observe(stage);
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('dblclick', onDoubleClick);
  stage.addEventListener('wheel', onWheel, { passive: false });

  // ------------------------------------------------------------------ pages

  async function load() {
    const token = ++loadToken;
    const { source, index, rotation } = page();
    finishText();
    selected = undefined;
    live = undefined;
    sheet.querySelector('canvas')?.remove();
    rendered = '';
    renderBars();
    let size;
    try {
      size = await registry.pageSize(source, index);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'This page could not be opened.');
      return;
    }
    if (token !== loadToken) return;
    view = new PageView(size, rotation);
    loaded = true;
    fit();
  }

  function goTo(next: number) {
    if (next < 0 || next >= doc.pages.length || next === position) return;
    finishText();
    position = next;
    void load();
  }

  // ------------------------------------------------------------------ zoom & drawing the page

  function fit() {
    const room = { width: stage.clientWidth - 48, height: stage.clientHeight - 48 };
    const { width, height } = view.viewSize;
    scale = Math.min(ZOOM.max * ACTUAL, Math.max(ZOOM.min * ACTUAL, Math.min(room.width / width, room.height / height)));
    fitting = true;
    layout();
  }

  function zoomBy(factor: number) {
    const next = Math.min(ZOOM.max * ACTUAL, Math.max(ZOOM.min * ACTUAL, scale * factor));
    if (next === scale) return;
    // Keep the middle of what is visible in the middle.
    const middle = { x: (stage.scrollLeft + stage.clientWidth / 2) / scale, y: (stage.scrollTop + stage.clientHeight / 2) / scale };
    scale = next;
    fitting = false;
    layout();
    stage.scrollLeft = middle.x * scale - stage.clientWidth / 2;
    stage.scrollTop = middle.y * scale - stage.clientHeight / 2;
  }

  function layout() {
    const { width, height } = view.viewSize;
    sheet.style.width = `${width * scale}px`;
    sheet.style.height = `${height * scale}px`;
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    draw();
    placeTextBox();
    renderBars();
    scheduleRender();
  }

  let renderTimer = 0;
  let renderToken = 0;
  let rendered = '';

  /** Renders the page sharp for the current zoom, shortly after zooming stops. */
  function scheduleRender() {
    const { source, index, rotation } = page();
    const pixels = scale * Math.min(window.devicePixelRatio || 1, 3);
    const key = `${source}:${index}:${rotation}:${pixels.toFixed(3)}`;
    if (key === rendered) return;
    clearTimeout(renderTimer);
    const hasCanvas = Boolean(sheet.querySelector('canvas'));
    renderTimer = window.setTimeout(async () => {
      const token = ++renderToken;
      try {
        const canvas = await registry.render(source, index, pixels, rotation);
        if (token !== renderToken || !root.isConnected) return;
        canvas.className = 'pe-canvas';
        sheet.querySelector('canvas')?.remove();
        sheet.prepend(canvas);
        rendered = key;
      } catch (error) {
        if (token === renderToken) toast(error instanceof Error ? error.message : 'This page could not be shown.');
      }
    }, hasCanvas ? 150 : 0);
  }

  /** Redraws the marks and the selection over the page. */
  function draw() {
    const grab = 12 / scale;
    const layers: SVGElement[] = [renderMarks(marks(), view, grab, editing?.mark.id)];
    const mark = selectedMark();
    if (mark && !editing) {
      const box = view.rectToView(markBounds(mark));
      const pad = 4 / scale;
      const outline = { x: box.x - pad, y: box.y - pad, width: box.width + 2 * pad, height: box.height + 2 * pad };
      const size = 10 / scale;
      const handle = (point: Point, name: string) =>
        svg('rect', { class: `pe-handle pe-handle-${name}`, 'data-handle': name, x: point.x - size / 2, y: point.y - size / 2, width: size, height: size });
      const handles =
        mark.type === 'line'
          ? [handle(view.toView(mark.from), 'from'), handle(view.toView(mark.to), 'to')]
          : [
              handle({ x: outline.x, y: outline.y }, 'nw'),
              handle({ x: outline.x + outline.width, y: outline.y }, 'ne'),
              handle({ x: outline.x, y: outline.y + outline.height }, 'sw'),
              handle({ x: outline.x + outline.width, y: outline.y + outline.height }, 'se'),
            ];
      layers.push(
        svg(
          'g',
          {},
          svg('rect', { class: 'pe-outline pe-outline-halo', ...outline }),
          svg('rect', { class: 'pe-outline', ...outline }),
          ...handles,
        ),
      );
    }
    replaceChildren(overlay, layers);
    sheet.dataset.tool = tool;
  }

  // ------------------------------------------------------------------ bars

  function button(label: string, onclick: () => void, { title = label, disabled = false, pressed, primary = false }: { title?: string; disabled?: boolean; pressed?: boolean; primary?: boolean } = {}) {
    return h(
      'button',
      {
        type: 'button',
        class: `tool${primary ? ' tool-primary' : ''}`,
        title,
        disabled,
        'aria-pressed': pressed === undefined ? undefined : String(pressed),
        onclick,
      },
      label,
    );
  }

  const group = (...children: Child[]) => h('div', { class: 'tool-group' }, children);

  function renderBars() {
    const draft = history();
    const count = doc.pages.length;
    replaceChildren(
      bar,
      group(button('Cancel', cancel, { title: 'Close without keeping the changes' })),
      group(
        button('‹', () => goTo(position - 1), { title: 'Previous page (Page Up)', disabled: position === 0 }),
        h(
          'span',
          { class: 'pe-title' },
          h('span', { class: 'pe-wide' }, 'Page '),
          `${position + 1} of ${count}`,
          h('span', { class: 'pe-name pe-wide' }, ` · ${doc.name}`),
        ),
        button('›', () => goTo(position + 1), { title: 'Next page (Page Down)', disabled: position === count - 1 }),
      ),
      h('div', { class: 'tool-spacer' }),
      group(
        button('Undo', undo, { disabled: !draft.canUndo, title: 'Undo (Ctrl+Z)' }),
        button('Redo', redo, { disabled: !draft.canRedo, title: 'Redo (Ctrl+Shift+Z)' }),
      ),
      h(
        'div',
        { class: 'tool-group pe-wide' },
        button('−', () => zoomBy(1 / ZOOM.step), { title: 'Zoom out' }),
        button(`${Math.round((scale / ACTUAL) * 100)}%`, fit, { title: 'Fit the page on screen' }),
        button('+', () => zoomBy(ZOOM.step), { title: 'Zoom in' }),
      ),
      group(button('Done', done, { primary: true, title: 'Keep the changes and go back to your files' })),
    );
    renderTools();
    renderProps();
  }

  function renderTools() {
    replaceChildren(
      tools,
      TOOLS.map((info) =>
        button(info.label, () => pickTool(info.id), {
          title: `${info.label} (${info.key.toUpperCase()})`,
          pressed: info.id === 'image' || info.id === 'signature' ? undefined : info.id === tool,
        }),
      ),
    );
  }

  /** The bar under the tools: the look of the selected mark or of the tool's next mark. */
  function renderProps() {
    const mark = selectedMark();
    const kind = tool === 'select' ? (mark && styleKind(mark.type)) : styleKind(tool);
    const target = mark && kind && styleKind(mark.type) === kind ? mark : undefined;
    const current = { ...(kind ? style[kind] : {}), ...(editing?.mark ?? target ?? {}) } as Record<string, unknown>;
    const parts: Child[] = [];

    const set = (patch: Record<string, unknown>) => {
      if (kind && tool !== 'select') Object.assign(style[kind], patch);
      if (editing) {
        editing.mark = fitText({ ...editing.mark, ...patch, text: editing.box.value });
        placeTextBox();
        renderProps();
        editing.box.focus();
      } else if (target) {
        let next = { ...target, ...patch } as Mark;
        if (next.type === 'text') next = fitText(next);
        push(replaceMark(history().present, next));
      } else {
        renderProps();
      }
    };

    if (kind === 'text') {
      parts.push(
        group(
          select(
            'Font',
            Object.entries(FONTS).map(([value, font]) => [value, font.label]),
            String(current.font),
            (value) => set({ font: value }),
          ),
          select(
            'Size',
            sizeChoices(Number(current.size)).map((size) => [String(size), `${size} pt`]),
            String(Math.round(Number(current.size))),
            (value) => set({ size: Number(value) }),
          ),
          button('Bold', () => set({ bold: !current.bold }), { pressed: Boolean(current.bold), title: 'Bold' }),
        ),
      );
    }
    if (kind) {
      parts.push(group(colorControl(String(current.color), kind === 'highlight' ? HIGHLIGHTS : COLORS, (color) => set({ color }))));
    }
    if (kind === 'ink' || kind === 'line' || (kind === 'shape' && !current.filled)) {
      parts.push(
        group(
          select(
            'Thickness',
            WIDTHS.map((width) => [String(width), `${width} pt`]),
            String(current.lineWidth),
            (value) => set({ lineWidth: Number(value) }),
          ),
        ),
      );
    }
    if (kind === 'shape') {
      parts.push(group(checkbox('Fill', Boolean(current.filled), (filled) => set({ filled }))));
    }
    if (target?.type === 'line') {
      parts.push(group(checkbox('Arrowhead', target.arrow, (arrow) => set({ arrow }))));
    }
    if (mark && tool === 'select' && mark.type === 'text') {
      parts.push(group(button('Edit text', () => editText(mark, false), { title: 'Change the text (Enter)' })));
    }
    if (mark && !editing) {
      parts.push(group(button('Delete', deleteSelected, { title: 'Delete what is selected (Del)' })));
    }
    const hint = TOOLS.find((info) => info.id === tool)?.hint;
    if (!target && hint) parts.push(h('span', { class: 'pe-hint' }, hint));
    replaceChildren(props, parts);
  }

  function select(label: string, options: string[][], value: string, onchange: (value: string) => void) {
    return h(
      'label',
      { class: 'pe-field' },
      h('span', { class: 'pe-label' }, label),
      h(
        'select',
        { class: 'input pe-select', onchange: (event: Event) => onchange((event.target as HTMLSelectElement).value) },
        options.map(([optionValue, text]) => h('option', { value: optionValue, selected: optionValue === value }, text)),
      ),
    );
  }

  function checkbox(label: string, checked: boolean, onchange: (checked: boolean) => void) {
    return h(
      'label',
      { class: 'checkbox pe-field' },
      h('input', { type: 'checkbox', checked, onchange: (event: Event) => onchange((event.target as HTMLInputElement).checked) }),
      label,
    );
  }

  function colorControl(value: string, palette: string[], onchange: (color: string) => void) {
    const swatches = palette.map((color) =>
      h('button', {
        type: 'button',
        class: 'pe-swatch',
        style: `--swatch:${color}`,
        title: color,
        'aria-label': `Colour ${color}`,
        'aria-pressed': String(color.toLowerCase() === value.toLowerCase()),
        // Keep the text box focused while its colour changes.
        onpointerdown: (event: Event) => event.preventDefault(),
        onclick: () => onchange(color),
      }),
    );
    return h(
      'div',
      { class: 'pe-field', role: 'group', 'aria-label': 'Colour' },
      h('span', { class: 'pe-label' }, 'Colour'),
      swatches,
      h(
        'span',
        { class: 'color pe-custom' },
        h('input', { type: 'color', value, title: 'Other colour', 'aria-label': 'Other colour', onchange: (event: Event) => onchange((event.target as HTMLInputElement).value) }),
      ),
    );
  }

  function sizeChoices(current: number): number[] {
    const rounded = Math.round(current);
    return SIZES.includes(rounded) ? SIZES : [...SIZES, rounded].sort((a, b) => a - b);
  }

  // ------------------------------------------------------------------ changes

  function push(next: readonly Mark[]) {
    live = undefined;
    history().push(next);
    if (selected && !next.some((mark) => mark.id === selected)) selected = undefined;
    draw();
    renderBars();
  }

  function undo() {
    finishText();
    if (!history().undo()) return;
    if (!selectedMark()) selected = undefined;
    draw();
    renderBars();
  }

  function redo() {
    finishText();
    if (!history().redo()) return;
    if (!selectedMark()) selected = undefined;
    draw();
    renderBars();
  }

  function replaceMark(list: readonly Mark[], next: Mark): readonly Mark[] {
    return list.map((mark) => (mark.id === next.id ? next : mark));
  }

  function deleteSelected() {
    if (!selected) return;
    const id = selected;
    selected = undefined;
    push(history().present.filter((mark) => mark.id !== id));
  }

  function selectMark(id: string | undefined) {
    if (selected === id) return;
    selected = id;
    draw();
    renderProps();
  }

  function pickTool(next: Tool | Action) {
    finishText();
    if (next === 'image') {
      imageInput.click();
      return;
    }
    if (next === 'signature') {
      void addSignature();
      return;
    }
    tool = next;
    if (tool !== 'select') selected = undefined;
    draw();
    renderTools();
    renderProps();
  }

  /** Changes made on any page, compared with the document. */
  function changes(): Map<string, readonly Mark[]> {
    const changed = new Map<string, readonly Mark[]>();
    for (const ref of doc.pages) {
      const draft = drafts.get(ref.key);
      if (draft && draft.present !== (ref.marks ?? []) && !(draft.present.length === 0 && !ref.marks?.length)) {
        changed.set(ref.key, draft.present);
      }
    }
    return changed;
  }

  function done() {
    finishText();
    const changed = changes();
    // Keep them first: the files re-render, and closing then puts the focus back on the page.
    if (changed.size) onDone(changed);
    close();
  }

  function cancel() {
    finishText();
    if (changes().size && !window.confirm('Close the page editor without keeping your changes?')) return;
    close();
  }

  function close() {
    clearTimeout(renderTimer);
    loadToken++;
    renderToken++;
    resizer.disconnect();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('page-editor-open');
    root.remove();
    onClose();
    if (opener?.isConnected) opener.focus();
  }

  // ------------------------------------------------------------------ text

  function editText(mark: TextMark, created: boolean) {
    finishText();
    selected = mark.id;
    const box = h('textarea', {
      class: 'pe-text',
      spellcheck: 'true',
      'aria-label': 'Text',
      // Choosing a font or size moves the focus to the bar; typing goes on after.
      onblur: (event: FocusEvent) => {
        if (!props.contains(event.relatedTarget as Node | null)) finishText();
      },
      oninput: () => {
        if (!editing) return;
        editing.mark = fitText({ ...editing.mark, text: box.value });
        placeTextBox();
      },
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape' || (event.key === 'Enter' && (event.ctrlKey || event.metaKey))) {
          event.preventDefault();
          event.stopPropagation();
          finishText();
          root.focus();
        }
      },
    });
    box.value = mark.text;
    editing = { mark, created, box };
    sheet.append(box);
    placeTextBox();
    draw();
    renderProps();
    box.focus();
    box.select();
  }

  /** Puts the text box exactly over the text it edits, turned the same way. */
  function placeTextBox() {
    if (!editing) return;
    const { mark, box } = editing;
    const origin = view.toView(mark);
    const turn = quarterTurn(mark.angle + view.rotation);
    Object.assign(box.style, {
      left: `${origin.x * scale}px`,
      top: `${origin.y * scale}px`,
      width: `${(mark.width + mark.size * 0.6) * scale}px`,
      height: `${mark.height * scale}px`,
      transform: `rotate(${turn}deg)`,
      font: `${mark.bold ? 700 : 400} ${mark.size * scale}px/${LINE_HEIGHT} ${FONTS[mark.font].css}`,
      color: mark.color,
    });
  }

  function finishText() {
    if (!editing) return;
    const { mark, created, box } = editing;
    editing = undefined;
    const text = box.value.replace(/\s+$/, '');
    box.remove();
    const list = history().present;
    if (!text.trim()) {
      selected = undefined;
      if (created) {
        draw();
        renderProps();
      } else push(list.filter((other) => other.id !== mark.id));
      return;
    }
    const next = fitText({ ...mark, text });
    selected = next.id;
    push(created ? [...list, next] : replaceMark(list, next));
  }

  // ------------------------------------------------------------------ images

  /** The middle of the visible part of the page, in view coordinates. */
  function visibleMiddle(): Point {
    const stageBox = stage.getBoundingClientRect();
    const sheetBox = sheet.getBoundingClientRect();
    const { width, height } = view.viewSize;
    const x = ((stageBox.left + stageBox.width / 2 - sheetBox.left) / sheetBox.width) * width;
    const y = ((stageBox.top + stageBox.height / 2 - sheetBox.top) / sheetBox.height) * height;
    return { x: Math.min(width, Math.max(0, x)), y: Math.min(height, Math.max(0, y)) };
  }

  /** Adds an image upright on screen, at most half the page, in the middle of the view. */
  function placeImage(image: MarkImage, width: number, height: number) {
    const viewSize = view.viewSize;
    const shrink = Math.min(1, (viewSize.width * 0.5) / width, (viewSize.height * 0.5) / height);
    const middle = visibleMiddle();
    const box = { x: middle.x - (width * shrink) / 2, y: middle.y - (height * shrink) / 2, width: width * shrink, height: height * shrink };
    const mark: Mark = { type: 'image', id: newId(), image, ...placeIn(view.rectFromView(box), -view.rotation) };
    tool = 'select';
    selected = mark.id;
    push([...history().present, mark]);
  }

  async function addImage(file: File) {
    try {
      const image = await prepareImage(file);
      const bitmap = await createImageBitmap(new Blob([image.bytes as Uint8Array<ArrayBuffer>]));
      const { width, height } = bitmap;
      bitmap.close();
      placeImage(image, width * 0.75, height * 0.75);
    } catch (error) {
      toast(error instanceof Error ? error.message : `"${file.name}" could not be added.`);
    }
  }

  async function addSignature() {
    const signature = await drawSignature();
    if (!signature) return;
    lastSignature = signature;
    placeImage(signature.image, signature.width, signature.height);
  }

  // ------------------------------------------------------------------ pointer

  type Gesture =
    | { kind: 'move'; start: Point; original: Mark; moved: boolean }
    | { kind: 'resize'; anchor: Point; start: Rect; original: Mark; ratio: boolean }
    | { kind: 'end'; end: 'from' | 'to'; original: LineMark }
    | { kind: 'create'; start: Point; mark: Mark };

  let gesture: Gesture | undefined;

  /** The pointer's place on the page and in the turned view. */
  function pointerAt(event: PointerEvent | MouseEvent): { page: Point; view: Point } {
    const box = overlay.getBoundingClientRect();
    const { width, height } = view.viewSize;
    const point = { x: ((event.clientX - box.left) / box.width) * width, y: ((event.clientY - box.top) / box.height) * height };
    return { page: view.fromView(point), view: point };
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0 || gesture) return;
    if (editing) {
      // The first click outside the text box only ends typing.
      finishText();
      if (tool === 'text') return;
    }
    const target = event.target as Element;
    const at = pointerAt(event);
    const markId = target.closest<SVGElement>('.pe-mark')?.dataset.id;
    const handle = target.closest<SVGElement>('[data-handle]')?.dataset.handle;
    const current = selectedMark();

    if (handle && current) {
      if (current.type === 'line' && (handle === 'from' || handle === 'to')) {
        gesture = { kind: 'end', end: handle, original: current };
      } else {
        const start = view.rectToView(markBounds(current));
        const anchor = {
          x: handle.includes('w') ? start.x + start.width : start.x,
          y: handle.includes('n') ? start.y + start.height : start.y,
        };
        gesture = { kind: 'resize', anchor, start, original: current, ratio: current.type === 'text' || current.type === 'image' };
      }
    } else if (tool === 'select') {
      const mark = marks().find((other) => other.id === markId);
      selectMark(mark?.id);
      if (!mark) return;
      gesture = { kind: 'move', start: at.page, original: mark, moved: false };
    } else if (tool === 'text') {
      const mark = marks().find((other) => other.id === markId);
      if (mark?.type === 'text') {
        event.preventDefault();
        editText(mark, false);
        return;
      }
      const { font, size, bold, color } = style.text;
      // Put the first line's middle where the click was.
      const origin = view.fromView({ x: at.view.x, y: at.view.y - size * 0.6 });
      const text = fitText({ type: 'text', id: newId(), text: '', font, size, bold, color, ...origin, width: 0, height: 0, angle: quarterTurn(-view.rotation) });
      event.preventDefault();
      editText(text, true);
      return;
    } else {
      selected = undefined;
      gesture = { kind: 'create', start: at.page, mark: newMark(at.page) };
      live = [...history().present, gesture.mark];
      draw();
    }
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerUp);
  }

  function newMark(at: Point): Mark {
    const id = newId();
    const box = { x: at.x, y: at.y, width: 0, height: 0 };
    switch (tool) {
      case 'draw':
        return { type: 'ink', id, points: [at], ...style.ink };
      case 'line':
      case 'arrow':
        return { type: 'line', id, from: at, to: at, arrow: tool === 'arrow', ...style.line };
      case 'rect':
      case 'ellipse':
        return { type: tool, id, ...box, ...style.shape };
      case 'whiteout':
      case 'highlight':
        return { type: tool, id, ...box, ...style[tool] };
      default:
        throw new Error(`No mark for ${tool}`);
    }
  }

  function onPointerMove(event: PointerEvent) {
    if (!gesture) return;
    const at = pointerAt(event);
    const list = history().present;

    switch (gesture.kind) {
      case 'move': {
        const dx = at.page.x - gesture.start.x;
        const dy = at.page.y - gesture.start.y;
        if (!gesture.moved && Math.hypot(dx, dy) * scale < 3) return;
        gesture.moved = true;
        live = replaceMark(list, moveMark(gesture.original, dx, dy));
        break;
      }
      case 'resize': {
        const { anchor, start, original } = gesture;
        let width = at.view.x - anchor.x;
        let height = at.view.y - anchor.y;
        if ((gesture.ratio || event.shiftKey) && start.width > 0 && start.height > 0) {
          const factor = Math.max(Math.abs(width) / start.width, Math.abs(height) / start.height);
          width = Math.sign(width || 1) * start.width * factor;
          height = Math.sign(height || 1) * start.height * factor;
        }
        const min = 2;
        const box = normalizeRect(anchor, {
          x: anchor.x + Math.sign(width || 1) * Math.max(Math.abs(width), start.width ? min : 0),
          y: anchor.y + Math.sign(height || 1) * Math.max(Math.abs(height), start.height ? min : 0),
        });
        let next = resizeMark(original, view.rectFromView(box));
        if (next.type === 'text') next = fitText(next);
        live = replaceMark(list, next);
        break;
      }
      case 'end': {
        const point = event.shiftKey ? snap(gesture.original[gesture.end === 'from' ? 'to' : 'from'], at) : at.page;
        live = replaceMark(list, { ...gesture.original, [gesture.end]: point });
        break;
      }
      case 'create': {
        const mark = grow(gesture.mark, gesture.start, at, event);
        gesture.mark = mark;
        live = [...list, mark];
        break;
      }
    }
    draw();
  }

  /** Keeps a line at 45° steps from `fixed`, as seen on screen. */
  function snap(fixed: Point, at: { view: Point }): Point {
    const start = view.toView(fixed);
    const dx = at.view.x - start.x;
    const dy = at.view.y - start.y;
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const length = Math.hypot(dx, dy);
    return view.fromView({ x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length });
  }

  function grow(mark: Mark, start: Point, at: { page: Point; view: Point }, event: PointerEvent): Mark {
    switch (mark.type) {
      case 'ink': {
        const events = event.getCoalescedEvents?.() ?? [];
        const points = [...mark.points];
        for (const point of (events.length ? events : [event]).map((item) => pointerAt(item).page)) {
          const last = points[points.length - 1];
          if (Math.hypot(point.x - last.x, point.y - last.y) * scale >= 1) points.push({ x: round(point.x), y: round(point.y) });
        }
        return { ...mark, points };
      }
      case 'line':
        return { ...mark, to: event.shiftKey ? snap(start, at) : at.page };
      default: {
        const from = view.toView(start);
        let to = at.view;
        if (event.shiftKey) {
          const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
          to = { x: from.x + Math.sign(to.x - from.x || 1) * side, y: from.y + Math.sign(to.y - from.y || 1) * side };
        }
        return { ...mark, ...view.rectFromView(normalizeRect(from, to)) } as Mark;
      }
    }
  }

  function onPointerUp() {
    overlay.removeEventListener('pointermove', onPointerMove);
    overlay.removeEventListener('pointerup', onPointerUp);
    overlay.removeEventListener('pointercancel', onPointerUp);
    const finished = gesture;
    gesture = undefined;
    if (!finished || !live) {
      live = undefined;
      draw();
      return;
    }
    if (finished.kind === 'create') {
      const bounds = markBounds(finished.mark);
      const tiny = finished.mark.type !== 'ink' && Math.max(bounds.width, bounds.height) < 2;
      if (tiny) {
        live = undefined;
        draw();
        return;
      }
      if (finished.mark.type !== 'ink') selected = finished.mark.id;
    }
    push(live);
  }

  function onDoubleClick(event: MouseEvent) {
    if (tool !== 'select') return;
    const id = (event.target as Element).closest<SVGElement>('.pe-mark')?.dataset.id;
    const mark = history().present.find((other) => other.id === id);
    if (mark?.type === 'text') editText(mark, false);
  }

  function onWheel(event: WheelEvent) {
    // Pinching on a touchpad arrives as a wheel event with Ctrl held.
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.01));
  }

  // ------------------------------------------------------------------ keyboard

  function onKey(event: KeyboardEvent) {
    if (document.querySelector('.dialog-backdrop')) return;
    const target = event.target as HTMLElement;
    if (target.closest?.('input, textarea, select')) return;
    if (target.closest?.('button') && (event.key === 'Enter' || event.key === ' ')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const handled = () => event.preventDefault();
    const mark = selectedMark();

    if (mod && key === 'z') {
      handled();
      if (event.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') {
      handled();
      redo();
    } else if (event.key === 'Escape') {
      handled();
      if (gesture) return;
      if (selected) selectMark(undefined);
      else if (tool !== 'select') pickTool('select');
      else cancel();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && mark) {
      handled();
      deleteSelected();
    } else if (event.key === 'Enter' && mark?.type === 'text') {
      handled();
      editText(mark, false);
    } else if (event.key.startsWith('Arrow') && mark && !mod) {
      handled();
      const step = event.shiftKey ? 10 : 1;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      // Arrows move it as seen on screen.
      const start = view.fromView({ x: 0, y: 0 });
      const end = view.fromView({ x: dx, y: dy });
      push(replaceMark(history().present, moveMark(mark, end.x - start.x, end.y - start.y)));
    } else if (event.key === 'PageUp') {
      handled();
      goTo(position - 1);
    } else if (event.key === 'PageDown') {
      handled();
      goTo(position + 1);
    } else if (!mod && !event.altKey) {
      const info = TOOLS.find((item) => item.key === key);
      if (info) {
        handled();
        pickTool(info.id);
      }
    }
  }

  // Last, so that everything it uses is set up.
  void load();
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * A dialog to draw a signature with the mouse, a pen or a finger. Resolves
 * with a trimmed PNG and its size in points, or undefined when cancelled.
 */
function drawSignature(): Promise<{ image: MarkImage; width: number; height: number } | undefined> {
  return new Promise((resolve) => {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 3);
    const canvas = h('canvas', { class: 'signature-pad', 'aria-label': 'Signature area' });
    const context = canvas.getContext('2d')!;
    let ink = '#111111';
    let strokes = 0;
    let last: Point | undefined;

    const use = h('button', { type: 'button', class: 'btn btn-primary', disabled: true, onclick: () => void finish() }, 'Add signature');
    const inks = ['#111111', '#1f3fbf'].map((color) =>
      h('button', {
        type: 'button',
        class: 'pe-swatch',
        style: `--swatch:${color}`,
        'aria-label': color === '#111111' ? 'Black ink' : 'Blue ink',
        'aria-pressed': String(color === ink),
        onclick: (event: Event) => {
          ink = color;
          for (const swatch of inks) swatch.setAttribute('aria-pressed', String(swatch === event.currentTarget));
        },
      }),
    );
    const dialog = h(
      'div',
      { class: 'dialog dialog-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'signature-title' },
      h('h2', { id: 'signature-title' }, 'Draw your signature'),
      h('div', { class: 'signature-frame' }, canvas),
      h(
        'div',
        { class: 'signature-tools' },
        h('div', { class: 'pe-field' }, h('span', { class: 'pe-label' }, 'Ink'), inks),
        h('button', { type: 'button', class: 'warning-action', onclick: clear }, 'Clear'),
      ),
      h('p', { class: 'dialog-note' }, 'Your signature stays on this device and is forgotten when you close LightPDF.'),
      h(
        'div',
        { class: 'dialog-actions' },
        lastSignature &&
          h('button', { type: 'button', class: 'btn btn-light', onclick: () => close(lastSignature) }, 'Use the last one'),
        h('button', { type: 'button', class: 'btn btn-light', onclick: () => close(undefined) }, 'Cancel'),
        use,
      ),
    );
    const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);
    document.body.append(backdrop);
    const box = canvas.getBoundingClientRect();
    canvas.width = Math.round(box.width * pixelRatio);
    canvas.height = Math.round(box.height * pixelRatio);
    context.scale(pixelRatio, pixelRatio);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = 2.5;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(undefined);
      }
    };
    document.addEventListener('keydown', onKey, true);

    function point(event: PointerEvent): Point {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      last = point(event);
      context.strokeStyle = ink;
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(last.x, last.y);
      context.stroke();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!last) return;
      for (const item of event.getCoalescedEvents?.() ?? [event]) {
        const next = point(item);
        context.beginPath();
        context.moveTo(last.x, last.y);
        context.lineTo(next.x, next.y);
        context.stroke();
        last = next;
      }
    });
    const end = () => {
      if (!last) return;
      last = undefined;
      strokes++;
      use.disabled = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    function clear() {
      context.clearRect(0, 0, canvas.width, canvas.height);
      strokes = 0;
      use.disabled = true;
    }

    function close(result: { image: MarkImage; width: number; height: number } | undefined) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    }

    async function finish() {
      if (!strokes) return;
      // Trim to the drawn part, with a little room for the round line ends.
      const { width, height } = canvas;
      const pixels = context.getImageData(0, 0, width, height).data;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (pixels[(y * width + x) * 4 + 3] > 0) {
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX < 0) return close(undefined);
      const pad = Math.round(2 * pixelRatio);
      minX = Math.max(0, minX - pad);
      minY = Math.max(0, minY - pad);
      maxX = Math.min(width - 1, maxX + pad);
      maxY = Math.min(height - 1, maxY + pad);
      const trimmed = document.createElement('canvas');
      trimmed.width = maxX - minX + 1;
      trimmed.height = maxY - minY + 1;
      trimmed.getContext('2d')!.drawImage(canvas, minX, minY, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
      const blob = await new Promise<Blob | null>((done) => trimmed.toBlob(done, 'image/png'));
      if (!blob) return close(undefined);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // Drawn at screen size; a signature about 180 points wide at most suits most forms.
      const points = (trimmed.width / pixelRatio) * 0.75;
      const shrink = Math.min(1, 180 / points);
      close({
        image: { bytes, kind: 'png' },
        width: points * shrink,
        height: (trimmed.height / pixelRatio) * 0.75 * shrink,
      });
    }
  });
}
