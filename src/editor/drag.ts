export interface DropTarget {
  doc: string;
  /** Insert position among the target document's current pages. */
  position: number;
}

export interface DragHandlers {
  /** The page keys to move when a drag starts on `key`, in display order. */
  keysFor(key: string): string[];
  onDrop(keys: string[], target: DropTarget): void;
}

const THRESHOLD = 6;
const EDGE = 70;

/**
 * Lets page cards (`.page`) inside `root` be dragged to a new place, within
 * or across documents (`.doc`). Uses pointer events, so it works with mouse,
 * pen and touch; on touch screens a drag starts from the `.page-grip` handle
 * so that swiping elsewhere still scrolls the page.
 */
export function enablePageDrag(root: HTMLElement, handlers: DragHandlers): () => void {
  let start: { x: number; y: number; key: string; card: HTMLElement } | undefined;
  let keys: string[] = [];
  let ghost: HTMLElement | undefined;
  let target: DropTarget | undefined;
  let pointer = { x: 0, y: 0 };
  let frame = 0;

  const clearMarkers = () =>
    root
      .querySelectorAll('.drop-before, .drop-after, .drop-end')
      .forEach((element) => element.classList.remove('drop-before', 'drop-after', 'drop-end'));

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

  function begin() {
    if (!start) return;
    keys = handlers.keysFor(start.key);
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
    target = findTarget(pointer.x, pointer.y);
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
      if (drop && target) handlers.onDrop(keys, target);
    }
    start = undefined;
    target = undefined;
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
    const card = element.closest<HTMLElement>('.page');
    if (!card || event.button !== 0 || element.closest('button, input, select')) return;
    if (event.pointerType === 'touch' && !element.closest('.page-grip')) return;
    start = { x: event.clientX, y: event.clientY, key: card.dataset.key!, card };
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
