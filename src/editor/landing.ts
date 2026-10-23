import { h } from '../ui/dom';
import { icon, type IconName } from '../ui/icons';

const CAPABILITIES: Array<[IconName, string]> = [
  ['merge', 'Merge'],
  ['split', 'Split'],
  ['organize', 'Reorder pages'],
  ['rotate', 'Rotate'],
  ['remove', 'Delete pages'],
  ['extract', 'Extract pages'],
  ['compress', 'Compress'],
  ['numbers', 'Page numbers'],
  ['watermark', 'Watermark'],
  ['image', 'Images to PDF'],
  ['photo', 'PDF to JPG / PNG'],
  ['text', 'PDF to text'],
];

const STEPS = [
  ['Add your files', 'PDFs and images. One file or many.'],
  ['Arrange and edit', 'Drag pages around, rotate, delete, split or merge.'],
  ['Download', 'As PDFs, images or text. Add page numbers or a watermark on the way.'],
];

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'shield', title: 'Private by design', text: 'Files are processed on your own device and are never uploaded to a server.' },
  { icon: 'wifiOff', title: 'Works offline', text: 'After your first visit, LightPDF keeps working without an internet connection.' },
  { icon: 'code', title: 'Free and open source', text: 'No sign-up, no watermarks, no file limits. The code is MIT licensed.' },
];

export function renderLanding(onSelect: () => void): HTMLElement {
  return h(
    'div',
    { class: 'landing' },
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Edit your PDFs in one place'),
      h('p', {}, 'Add PDFs or images, then merge, split, reorder, compress and convert them. Everything runs on your device.'),
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
      icon('upload', 'icon icon-xl dropzone-icon'),
      h('span', { class: 'btn btn-primary btn-select' }, 'Select files'),
      h('span', { class: 'dropzone-hint' }, 'or drop PDFs and images here'),
    ),
    h(
      'ul',
      { class: 'capabilities', 'aria-label': 'What you can do' },
      CAPABILITIES.map(([name, label]) => h('li', {}, icon(name, 'icon icon-sm'), label)),
    ),
    h(
      'ol',
      { class: 'steps' },
      STEPS.map(([title, text], i) =>
        h('li', {}, h('span', { class: 'step-number' }, String(i + 1)), h('h3', {}, title), h('p', {}, text)),
      ),
    ),
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
