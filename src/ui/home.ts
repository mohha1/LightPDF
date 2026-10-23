import { CATEGORIES, TOOLS } from '../tools';
import type { Category } from '../tools/types';
import { h, replaceChildren } from './dom';
import { icon, type IconName } from './icons';

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  {
    icon: 'shield',
    title: 'Private by design',
    text: 'Files are processed on your own device and are never uploaded to a server.',
  },
  {
    icon: 'wifiOff',
    title: 'Works offline',
    text: 'After your first visit, LightPDF keeps working without an internet connection.',
  },
  {
    icon: 'code',
    title: 'Free and open source',
    text: 'No sign-up, no watermarks, no file limits. The code is MIT licensed.',
  },
];

export function mountHome(root: HTMLElement): void {
  let active: Category | 'all' = 'all';

  const cards = TOOLS.map((tool) =>
    h(
      'a',
      { class: 'tool-card', href: `#/${tool.id}`, 'data-category': tool.category, style: `--tool-color:${tool.color}` },
      h('span', { class: 'tool-icon' }, icon(tool.icon)),
      h('h3', {}, tool.title),
      h('p', {}, tool.description),
    ),
  );

  const filters = [{ id: 'all' as const, label: 'All' }, ...CATEGORIES].map((category) =>
    h(
      'button',
      {
        type: 'button',
        class: 'filter',
        'aria-pressed': String(category.id === active),
        onclick: () => {
          active = category.id;
          filters.forEach((button, i) =>
            button.setAttribute('aria-pressed', String(i === 0 ? active === 'all' : CATEGORIES[i - 1].id === active)),
          );
          cards.forEach((card) => {
            card.hidden = active !== 'all' && card.dataset.category !== active;
          });
        },
      },
      category.label,
    ),
  );

  replaceChildren(
    root,
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Every PDF tool you need, right in your browser'),
      h(
        'p',
        {},
        'Merge, split, compress, convert and edit PDFs for free. Everything runs on your device, so your files stay private.',
      ),
    ),
    h('div', { class: 'filters', role: 'group', 'aria-label': 'Filter tools' }, filters),
    h('div', { class: 'tool-grid' }, cards),
    h(
      'section',
      { class: 'features' },
      FEATURES.map((feature) =>
        h(
          'div',
          { class: 'feature' },
          h('span', { class: 'feature-icon' }, icon(feature.icon)),
          h('h3', {}, feature.title),
          h('p', {}, feature.text),
        ),
      ),
    ),
  );
}
