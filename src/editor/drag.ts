export interface DropTarget {
  doc: string;
  /** Insert position among the target document's current pages. */
  position: number;
}

export interface DragHandlers {
  /** The page keys to move when a drag starts on `key`, in display order. */
  keysFor(key: string): string[];
  onDrop(keys: string[], target: DropTarget): void;
  /** A whole document was dragged; `before` is the index it goes in front of (the count for the end). */
  onDocDrop(id: string, before: number): void;
}

const THRESHOLD = 6;
const EDGE = 70;

/**
 * Lets page cards (`.page`) inside `root` be dragged to a new place, within
 * or across documents (`.doc`), and whole documents be dragged by their
 * header to reorder them. Uses pointer events, so it works with mouse, pen
 * and touch; on touch screens a drag starts from the `.page-grip` or
 * `.doc-grip` handle so that swiping elsewhere still scrolls the page.
 */
export function enablePageDrag(root: HTMLElement, handlers: DragHandlers): () => void {
  let start: { x: number; y: number; key: string; card: HTMLElement; doc: boolean } | undefined;
  let keys: string[] = [];
  let ghost: HTMLElement | undefined;
  let target: DropTarget | undefined;
  let docTarget: number | undefined;
  let pointer = { x: 0, y: 0 };
  let frame = 0;

  const clearMarkers = () =>
    root
      .querySelectorAll('.drop-before, .drop-after, .drop-above, .drop-below, .drop-end')
      .forEach((element) => element.classList.remove('drop-before', 'drop-after', 'drop-above', 'drop-below', 'drop-end'));

  function findTarget(x: number, y: number): DropTarget | undefined {
    clearMarkers();
    const element = document.elementFromPoint(x, y);
    const card = element?.closest<HTMLElement>('.page');
    if (card && root.contains(card)) {
      const box = card.getBoundingClientRect();
      const after = x > box.left + box.width / 2;
      card.classList.add(after ? 'drop-after' : 'drop-before');
      return { doc: card.dataset.doc!, position: Number(card.dataset.position) + (after ? 1 : 0) };
    }
    const doc = element?.closest<HTMLElement>('.doc');
    if (doc && root.contains(doc)) {
      doc.classList.add('drop-end');
      return { doc: doc.dataset.doc!, position: Number(doc.dataset.count) };
    }
    return undefined;
  }

  // Between cards the last place found stays marked, so the marker doesn't flicker across gaps.
  function findDocTarget(x: number, y: number): number | undefined {
    const doc = document.elementFromPoint(x, y)?.closest<HTMLElement>('.doc');
    if (!doc || !root.contains(doc)) return docTarget;
    clearMarkers();
    const box = doc.getBoundingClientRect();
    // A card filling its row has no neighbours beside it, so it takes drops above or below.
    const fillsRow = box.width >= root.clientWidth - 1;
    const after = fillsRow ? y > box.top + box.height / 2 : x > box.left + box.width / 2;
    doc.classList.add(fillsRow ? (after ? 'drop-below' : 'drop-above') : after ? 'drop-after' : 'drop-before');
    return Number(doc.dataset.index) + (after ? 1 : 0);
  }

  function begin() {
    if (!start) return;
    keys = start.doc ? [] : handlers.keysFor(start.key);
    if (start.doc) start.card.classList.add('is-moving');
    for (const key of keys) root.querySelector(`.page[data-key="${key}"]`)?.classList.add('is-moving');
    const preview = start.card.querySelector('img')?.cloneNode() as HTMLElement | undefined;
    ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    if (preview) ghost.append(preview);
    if (keys.length > 1) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(keys.length);
      ghost.append(badge);
    }
    document.body.append(ghost);
    document.body.classList.add('is-dragging-pages');
    frame = requestAnimationFrame(tick);
  }

  // Moves the ghost and scrolls the window when the pointer nears its edges.
  function tick() {
    if (!ghost) return;
    ghost.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
    const speed = pointer.y < EDGE ? -(EDGE - pointer.y) / 3 : pointer.y > innerHeight - EDGE ? (pointer.y - innerHeight + EDGE) / 3 : 0;
    if (speed) window.scrollBy(0, speed);
    if (start?.doc) docTarget = findDocTarget(pointer.x, pointer.y);
    else target = findTarget(pointer.x, pointer.y);
    frame = requestAnimationFrame(tick);
  }

  function finish(drop: boolean) {
    const wasDragging = Boolean(ghost);
    cancelAnimationFrame(frame);
    ghost?.remove();
    ghost = undefined;
    clearMarkers();
    root.querySelectorAll('.is-moving').forEach((element) => element.classList.remove('is-moving'));
    document.body.classList.remove('is-dragging-pages');
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    if (wasDragging) {
      // The click that ends a drag shouldn't also toggle the page's selection.
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (drop && start?.doc && docTarget !== undefined) handlers.onDocDrop(start.key, docTarget);
      else if (drop && target) handlers.onDrop(keys, target);
    }
    start = undefined;
    target = undefined;
    docTarget = undefined;
  }

  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };

  function onMove(event: PointerEvent) {
    pointer = { x: event.clientX, y: event.clientY };
    if (start && !ghost && Math.hypot(event.clientX - start.x, event.clientY - start.y) > THRESHOLD) begin();
    if (ghost) event.preventDefault();
  }
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') finish(false);
  };

  function onDown(event: PointerEvent) {
    const element = event.target as HTMLElement;
    const doc = element.closest('.doc-header') ? element.closest<HTMLElement>('.doc') : null;
    const card = doc ?? element.closest<HTMLElement>('.page');
    if (!card || event.button !== 0 || element.closest('button, input, select')) return;
    if (event.pointerType === 'touch' && !element.closest(doc ? '.doc-grip' : '.page-grip')) return;
    if (doc && root.querySelectorAll('.doc').length < 2) return;
    start = { x: event.clientX, y: event.clientY, key: doc ? doc.dataset.doc! : card.dataset.key!, card, doc: Boolean(doc) };
    pointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
  }

  root.addEventListener('pointerdown', onDown);
  return () => {
    finish(false);
    root.removeEventListener('pointerdown', onDown);
  };
}
