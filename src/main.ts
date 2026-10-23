import './styles.css';
import { findTool } from './tools';
import { h } from './ui/dom';
import { mountHome } from './ui/home';
import { closeMenus, renderFooter, renderHeader } from './ui/layout';
import { mountTool } from './ui/workspace';

const header = renderHeader();
const main = h('main', { id: 'main' });
document.body.append(header, main, renderFooter());

let unmount: (() => void) | undefined;

function route() {
  unmount?.();
  unmount = undefined;
  closeMenus(header);

  const tool = findTool(location.hash.replace(/^#\/?/, ''));
  if (tool) {
    document.title = `${tool.title} · LightPDF`;
    main.className = 'page-tool';
    unmount = mountTool(main, tool);
  } else {
    document.title = 'LightPDF · Free, private PDF tools';
    main.className = 'page-home';
    mountHome(main);
  }
  window.scrollTo(0, 0);
}

const routeOf = (hash: string) => hash.replace(/^#\/?/, '');

window.addEventListener('hashchange', route);
// A link to the page you're already on restarts it, e.g. "Merge PDF" from the merge results.
document.addEventListener('click', (event) => {
  const link = (event.target as Element).closest?.('a[href^="#"]');
  if (link && routeOf(link.getAttribute('href')!) === routeOf(location.hash)) {
    event.preventDefault();
    route();
  }
});
route();

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the app works without it.
  });
}
