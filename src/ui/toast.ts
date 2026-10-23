import { h } from './dom';

let current: HTMLElement | undefined;

/** Shows a short message at the bottom of the screen, optionally with one action button. */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  current?.remove();
  const element = h(
    'div',
    { class: 'toast', role: 'status' },
    h('span', {}, message),
    action &&
      h(
        'button',
        {
          type: 'button',
          class: 'toast-action',
          onclick: () => {
            element.remove();
            action.run();
          },
        },
        action.label,
      ),
  );
  current = element;
  document.body.append(element);
  setTimeout(() => element.classList.add('toast-hide'), 5000);
  setTimeout(() => element.remove(), 5500);
}
