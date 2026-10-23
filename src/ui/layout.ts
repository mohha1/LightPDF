import { h } from './dom';
import { icon } from './icons';

export const REPOSITORY_URL = 'https://github.com/mohha1/LightPDF';

export function renderHeader(): HTMLElement {
  return h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'header-inner' },
      h(
        'a',
        { class: 'logo', href: './', 'aria-label': 'LightPDF' },
        h('span', { class: 'logo-mark' }, icon('bolt')),
        h('span', { class: 'logo-text' }, 'Light', h('b', {}, 'PDF')),
      ),
      h('span', { class: 'header-badge' }, icon('shield', 'icon icon-sm'), 'Files stay on your device'),
    ),
  );
}

export function renderFooter(): HTMLElement {
  return h(
    'footer',
    { class: 'site-footer' },
    h(
      'div',
      { class: 'footer-inner' },
      h('span', { class: 'footer-brand' }, 'Light', h('b', {}, 'PDF')),
      h('p', {}, 'Free, open-source PDF tools. Your files are processed in your browser and never uploaded.'),
      h('a', { href: REPOSITORY_URL, target: '_blank', rel: 'noopener' }, icon('code', 'icon icon-sm'), 'Source code (MIT)'),
    ),
  );
}
