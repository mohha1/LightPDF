import { h } from './dom';

/** Shows a short message at the bottom of the screen. */
export function toast(message: string): void {
  const element = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(element);
  setTimeout(() => element.classList.add('toast-hide'), 4000);
  setTimeout(() => element.remove(), 4500);
}
