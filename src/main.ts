import './styles.css';
import { mountEditor } from './editor/editor';
import { h } from './ui/dom';
import { renderHeader } from './ui/layout';

const main = h('main', { id: 'main' });
document.body.append(renderHeader(), main);
mountEditor(main);

if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // Offline support is a bonus; the app works without it.
  });
}
