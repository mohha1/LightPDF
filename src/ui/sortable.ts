/**
 * Lets the children of `container` that match `selector` be dragged into a new
 * order. Calls `onMove(from, to)` with indices among those children.
 */
export function makeSortable(container: HTMLElement, selector: string, onMove: (from: number, to: number) => void): void {
  let dragged: HTMLElement | null = null;

  const items = () => [...container.querySelectorAll<HTMLElement>(selector)];
  const clearMarkers = () =>
    items().forEach((item) => item.classList.remove('drop-before', 'drop-after', 'dragging'));

  container.addEventListener('dragstart', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLElement>(selector);
    if (!item || !event.dataTransfer) return;
    dragged = item;
    item.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', 'lightpdf-item');
  });

  container.addEventListener('dragover', (event) => {
    if (!dragged) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
    event.preventDefault();
    items().forEach((item) => item.classList.remove('drop-before', 'drop-after'));
    if (!target || target === dragged) return;
    target.classList.add(isAfter(event, target) ? 'drop-after' : 'drop-before');
  });

  container.addEventListener('drop', (event) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    const target = (event.target as HTMLElement).closest<HTMLElement>(selector);
    const list = items();
    const from = list.indexOf(dragged);
    if (target && target !== dragged) {
      let to = list.indexOf(target) + (isAfter(event, target) ? 1 : 0);
      if (from < to) to--;
      if (to !== from) onMove(from, to);
    }
    dragged = null;
    clearMarkers();
  });

  container.addEventListener('dragend', () => {
    dragged = null;
    clearMarkers();
  });
}

function isAfter(event: DragEvent, target: HTMLElement): boolean {
  const box = target.getBoundingClientRect();
  return event.clientX > box.left + box.width / 2;
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
