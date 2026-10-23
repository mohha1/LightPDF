const DOC = '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>';

/** Inner SVG markup for a 24×24, stroke-based icon. */
const PATHS = {
  // Tools
  merge: '<path d="M8 3H5a2 2 0 0 0-2 2v12"/><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M14 11v6M11 14h6"/>',
  split: '<rect x="4" y="2.5" width="16" height="7" rx="1.5"/><rect x="4" y="14.5" width="16" height="7" rx="1.5"/><path d="M2 12h20" stroke-dasharray="2.5 2"/>',
  remove: `${DOC}<path d="M9 14.5h6"/>`,
  extract: `${DOC}<path d="M12 18v-6M9 15l3-3 3 3"/>`,
  organize: '<rect x="3" y="3" width="7" height="9" rx="1.2"/><rect x="14" y="3" width="7" height="9" rx="1.2"/><rect x="3" y="15" width="7" height="6" rx="1.2"/><rect x="14" y="15" width="7" height="6" rx="1.2"/>',
  rotate: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5v5h-5"/>',
  compress: '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  photo: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 16l5-5 4 4 3-3 6.5 6.5"/><circle cx="16" cy="9.5" r="1.5"/>',
  text: `${DOC}<path d="M8.5 12.5h7M8.5 16h7M8.5 9h2"/>`,
  numbers: '<path d="M4 9h16M4 15h16M10 3L8 21M16 3l-2 18"/>',
  watermark: '<path d="M12 2.8l5.6 5.7a7.9 7.9 0 1 1-11.2 0z"/>',
  tag: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  layers: '<path d="M12 2.5l9.5 5-9.5 5-9.5-5z"/><path d="M2.5 16.5l9.5 5 9.5-5M2.5 12l9.5 5 9.5-5"/>',
  // Interface
  upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  rotateLeft: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 3.5v5h5"/>',
  rotateRight: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a2 2 0 0 1 2-2h11"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  arrowLeft: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  arrowRight: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  sort: '<path d="M3 6h13M3 12h9M3 18h5M17 10V20M14 17l3 3 3-3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  wifiOff: '<path d="M2 2l20 20M8.5 16.4a5 5 0 0 1 7 0M5 12.9a10 10 0 0 1 5.2-2.8M19 12.9a10 10 0 0 0-2.5-1.7M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  checkAll: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12.5l3 3 5-6"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 3.5v5h5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.5-4.5"/>',
  bolt: '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function iconMarkup(name: IconName): string {
  return (
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}

export function icon(name: IconName, className = 'icon'): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = iconMarkup(name);
  const svg = template.content.firstElementChild as SVGSVGElement;
  svg.setAttribute('class', className);
  return svg;
}
