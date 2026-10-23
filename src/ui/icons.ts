/** Inner SVG markup for a 24×24, stroke-based icon. */
const PATHS = {
  merge: '<path d="M8 3H5a2 2 0 0 0-2 2v12"/><rect x="7" y="7" width="14" height="14" rx="2"/><path d="M14 11v6M11 14h6"/>',
  split: '<rect x="4" y="2.5" width="16" height="7" rx="1.5"/><rect x="4" y="14.5" width="16" height="7" rx="1.5"/><path d="M2 12h20" stroke-dasharray="2.5 2"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  rotateRight: '<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3.5v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 11v6M14 11v6"/>',
  download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  alert: '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5M12 16.5h.01"/>',
  chevronLeft: '<path d="M15 6l-6 6 6 6"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function iconMarkup(name: IconName): string {
  return (
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
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
