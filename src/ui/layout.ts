import { h } from './dom';

const REPOSITORY_URL = 'https://github.com/mohha1/LightPDF';

export function renderHeader(): HTMLElement {
  return h(
    'header',
    { class: 'site-header' },
    h('a', { class: 'wordmark', href: './' }, 'LightPDF'),
    h(
      'span',
      { class: 'header-meta' },
      h('span', { class: 'header-note' }, 'Files stay on your device'),
      h('a', { href: REPOSITORY_URL, target: '_blank', rel: 'noopener' }, 'Source'),
    ),
  );
}
