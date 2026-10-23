import { h } from '../ui/dom';
import { icon } from '../ui/icons';
import { logo } from '../ui/logo';

export function renderLanding(onSelect: () => void): HTMLElement {
  return h(
    'div',
    { class: 'landing' },
    h('h1', { class: 'landing-logo' }, logo()),
    h(
      'div',
      {
        class: 'dropzone',
        role: 'button',
        tabindex: 0,
        'aria-label': 'Select PDF or image files',
        onclick: onSelect,
        onkeydown: (event: KeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect();
          }
        },
      },
      icon('upload', 'icon'),
      h('span', { class: 'btn btn-primary' }, 'Select files'),
      h('span', { class: 'dropzone-hint' }, 'or drop PDFs and images here'),
    ),
  );
}
