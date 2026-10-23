import { h } from '../ui/dom';
import { icon } from '../ui/icons';

export function renderLanding(onSelect: () => void): HTMLElement {
  return h(
    'div',
    { class: 'landing' },
    h('h1', {}, 'Edit PDFs in one place'),
    h(
      'p',
      { class: 'landing-lead' },
      'Merge, split, reorder, rotate, compress and convert PDFs and images. Files stay on this device.',
    ),
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
