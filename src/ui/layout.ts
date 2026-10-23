import { CATEGORIES, findTool, TOOLS } from '../tools';
import type { Tool } from '../tools/types';
import { h } from './dom';
import { icon } from './icons';

export const REPOSITORY_URL = 'https://github.com/mohha1/LightPDF';

function toolLink(tool: Tool): HTMLElement {
  return h(
    'a',
    { class: 'menu-link', href: `#/${tool.id}`, style: `--tool-color:${tool.color}` },
    h('span', { class: 'menu-icon' }, icon(tool.icon, 'icon icon-sm')),
    tool.title,
  );
}

function allToolsMenu(): HTMLElement {
  return h(
    'div',
    { class: 'mega' },
    CATEGORIES.map((category) =>
      h(
        'div',
        { class: 'mega-column' },
        h('h4', {}, category.label),
        TOOLS.filter((tool) => tool.category === category.id).map(toolLink),
      ),
    ),
  );
}

function dropdown(label: string, panelClass: string, content: HTMLElement): HTMLElement {
  return h(
    'details',
    { class: 'nav-dropdown' },
    h('summary', { class: 'nav-link' }, label, icon('chevronDown', 'icon icon-xs')),
    h('div', { class: `menu-panel ${panelClass}` }, content),
  );
}

export function renderHeader(): HTMLElement {
  const quick = ['merge-pdf', 'split-pdf', 'compress-pdf'].map((id) => findTool(id)!);
  const convert = h('div', { class: 'menu-list' }, TOOLS.filter((tool) => tool.category === 'convert').map(toolLink));

  const header = h(
    'header',
    { class: 'site-header' },
    h(
      'div',
      { class: 'header-inner' },
      h(
        'a',
        { class: 'logo', href: '#/', 'aria-label': 'LightPDF home' },
        h('span', { class: 'logo-mark' }, icon('bolt')),
        h('span', { class: 'logo-text' }, 'Light', h('b', {}, 'PDF')),
      ),
      h(
        'nav',
        { class: 'nav-desktop', 'aria-label': 'Tools' },
        quick.map((tool) => h('a', { class: 'nav-link', href: `#/${tool.id}` }, tool.title)),
        dropdown('Convert PDF', 'panel-small', convert),
        dropdown('All PDF tools', 'panel-mega', allToolsMenu()),
      ),
      h('span', { class: 'header-badge' }, icon('shield', 'icon icon-sm'), 'Files stay on your device'),
      h(
        'details',
        { class: 'nav-mobile' },
        h('summary', { class: 'menu-toggle', 'aria-label': 'Menu' }, icon('menu')),
        h('div', { class: 'menu-panel panel-mobile' }, allToolsMenu()),
      ),
    ),
  );

  // Close open menus when clicking elsewhere.
  document.addEventListener('click', (event) => {
    header.querySelectorAll('details[open]').forEach((details) => {
      if (!details.contains(event.target as Node)) details.removeAttribute('open');
    });
  });
  return header;
}

export function closeMenus(header: HTMLElement): void {
  header.querySelectorAll('details[open]').forEach((details) => details.removeAttribute('open'));
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
