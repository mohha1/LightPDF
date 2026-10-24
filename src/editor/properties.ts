import type { DocInfo } from '../core/sanitize';
import { h } from '../ui/dom';
import type { FileDetails } from './sources';

const FIELDS: Array<{ key: keyof DocInfo; label: string; source: string; help?: string }> = [
  { key: 'title', label: 'Title', source: 'Title' },
  { key: 'author', label: 'Author', source: 'Author' },
  { key: 'subject', label: 'Subject', source: 'Subject' },
  { key: 'keywords', label: 'Keywords', source: 'Keywords', help: 'Separated by commas.' },
];

/** "D:20240131093000+01'00'" as "2024-01-31 09:30". */
function pdfDate(value: string | undefined): string | undefined {
  const match = value && /^D?:?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(value);
  if (!match) return value;
  const [, year, month = '01', day = '01', hour, minute] = match;
  return `${year}-${month}-${day}${hour ? ` ${hour}:${minute ?? '00'}` : ''}`;
}

/**
 * Shows a document's properties, and what its first PDF holds besides its
 * pages, and lets the person change the properties. Resolves with the new
 * properties, or undefined when cancelled.
 */
export function editProperties(name: string, current: DocInfo | undefined, details: FileDetails | undefined): Promise<DocInfo | undefined> {
  return new Promise((resolve) => {
    const info = details?.info ?? {};
    const inputs = FIELDS.map((field) => {
      const input = h('input', { class: 'input', id: `prop-${field.key}`, spellcheck: 'false' });
      input.value = current ? (current[field.key] ?? '') : (info[field.source] ?? '');
      return { field, input };
    });

    const facts: string[] = [];
    const made = [...new Set([info.Creator, info.Producer].filter(Boolean))].join(', ');
    if (made) facts.push(`Made with ${made}.`);
    const dates = [pdfDate(info.CreationDate) && `created ${pdfDate(info.CreationDate)}`, pdfDate(info.ModDate) && `changed ${pdfDate(info.ModDate)}`].filter(Boolean);
    if (dates.length) facts.push(`${dates.join(', ')}.`.replace(/^./, (letter) => letter.toUpperCase()));
    if (details?.hasXmp) facts.push('XMP metadata, which can hold more about the file and its history.');
    if (details?.attachments.length) facts.push(`Attached files: ${details.attachments.join(', ')}.`);
    if (details?.hasScripts) facts.push('Scripts that run when the file is opened or used.');

    const close = (result: DocInfo | undefined) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    };
    const save = () => close(Object.fromEntries(inputs.map(({ field, input }) => [field.key, input.value.trim()])) as DocInfo);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(undefined);
      } else if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT') {
        event.preventDefault();
        save();
      }
    };

    const dialog = h(
      'div',
      { class: 'dialog dialog-wide', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'properties-title' },
      h('h2', { id: 'properties-title' }, `Properties: ${name}`),
      inputs.map(({ field, input }) =>
        h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id }, field.label), input, field.help && h('p', { class: 'field-help' }, field.help)),
      ),
      details &&
        h(
          'div',
          { class: 'properties-facts' },
          h('h3', { class: 'field-section' }, 'Also in the original file'),
          facts.length ? facts.map((fact) => h('p', { class: 'dialog-line' }, fact)) : h('p', { class: 'dialog-line' }, 'Nothing else.'),
          facts.length > 0 && h('p', { class: 'dialog-note' }, 'To take these out, choose Remove hidden data in the Download panel.'),
        ),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-light', onclick: () => close(undefined) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Save'),
      ),
    );
    const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    inputs[0].input.focus();
  });
}
