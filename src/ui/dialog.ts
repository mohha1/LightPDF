import { formatBytes, type OutputFile } from '../browser/files';
import { h, replaceChildren } from './dom';
import { icon } from './icons';

export interface ProgressDialog {
  update(fraction: number, label: string): void;
  done(file: OutputFile, summary: string | undefined, onDownload: () => void): void;
  fail(message: string): void;
  close(): void;
}

/** A modal that shows export progress, then the result or an error. */
export function progressDialog(onCancel: () => void): ProgressDialog {
  const bar = h('div', { class: 'progress-bar' });
  const label = h('p', { class: 'dialog-label' }, 'Starting…');
  const body = h('div', { class: 'dialog-body' });
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' }, body);
  const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') cancelButton.click();
  };
  const cancelButton = h('button', { type: 'button', class: 'btn btn-light', onclick: () => onCancel() }, 'Cancel');

  replaceChildren(
    body,
    h('h2', { id: 'dialog-title' }, 'Preparing your download'),
    h('div', { class: 'progress', role: 'progressbar' }, bar),
    label,
    h('p', { class: 'muted dialog-note' }, 'Working on your device. Nothing is uploaded.'),
    h('div', { class: 'dialog-actions' }, cancelButton),
  );
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  cancelButton.focus();

  return {
    update(fraction, text) {
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
      label.textContent = text;
    },
    done(file, summary, onDownload) {
      const closeButton = h('button', { type: 'button', class: 'btn btn-light', onclick: close }, 'Back to editor');
      cancelButton.onclick = close;
      replaceChildren(
        body,
        h('span', { class: 'dialog-icon' }, icon('check')),
        h('h2', { id: 'dialog-title' }, 'Your download has started'),
        h('p', { class: 'dialog-file' }, `${file.name} · ${formatBytes(file.blob.size)}`),
        summary && h('p', { class: 'dialog-summary' }, summary),
        h(
          'div',
          { class: 'dialog-actions' },
          closeButton,
          h('button', { type: 'button', class: 'btn btn-primary', onclick: onDownload }, icon('download', 'icon icon-sm'), 'Download again'),
        ),
      );
      closeButton.focus();
    },
    fail(message) {
      const closeButton = h('button', { type: 'button', class: 'btn btn-primary', onclick: close }, 'Back to editor');
      cancelButton.onclick = close;
      replaceChildren(
        body,
        h('span', { class: 'dialog-icon dialog-icon-error' }, icon('alert')),
        h('h2', { id: 'dialog-title' }, 'That didn’t work'),
        h('p', { class: 'dialog-summary' }, message),
        h('div', { class: 'dialog-actions' }, closeButton),
      );
      closeButton.focus();
    },
    close,
  };
}
