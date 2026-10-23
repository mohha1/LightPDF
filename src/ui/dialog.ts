import { h, replaceChildren, type Child } from './dom';
import { icon } from './icons';

export interface DialogAction {
  label: string;
  run: () => void;
  primary?: boolean;
}

export interface DialogState {
  title: string;
  tone?: 'done' | 'error';
  lines?: Array<string | undefined | false>;
  actions: DialogAction[];
}

export interface ProgressDialog {
  update(fraction: number, label: string): void;
  /** Replaces the progress view with a result. */
  show(state: DialogState): void;
  close(): void;
}

/** A modal that shows progress, then a result with actions. */
export function progressDialog(title: string, onCancel: () => void): ProgressDialog {
  const bar = h('div', { class: 'progress-bar' });
  const label = h('p', { class: 'dialog-label' }, 'Starting…');
  const body = h('div', { class: 'dialog-body' });
  const dialog = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' }, body);
  const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);
  let onEscape = onCancel;

  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') onEscape();
  };

  const actionRow = (actions: DialogAction[]): HTMLElement => {
    const buttons = actions.map((action) =>
      h('button', { type: 'button', class: `btn ${action.primary ? 'btn-primary' : 'btn-light'}`, onclick: action.run }, action.label),
    );
    return h('div', { class: 'dialog-actions' }, buttons);
  };

  const cancel = { label: 'Cancel', run: onCancel };
  replaceChildren(
    body,
    h('h2', { id: 'dialog-title' }, title),
    h('div', { class: 'progress', role: 'progressbar' }, bar),
    label,
    h('p', { class: 'dialog-note' }, 'Working on your device. Nothing is uploaded.'),
    actionRow([cancel]),
  );
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey);
  body.querySelector('button')?.focus();

  return {
    update(fraction, text) {
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
      label.textContent = text;
    },
    show(state) {
      onEscape = close;
      const lines: Child[] = (state.lines ?? []).filter(Boolean).map((line) => h('p', { class: 'dialog-line' }, line as string));
      replaceChildren(
        body,
        state.tone && h('span', { class: 'dialog-icon' }, icon(state.tone === 'error' ? 'alert' : 'check')),
        h('h2', { id: 'dialog-title' }, state.title),
        lines,
        actionRow(state.actions),
      );
      (body.querySelector<HTMLElement>('.btn-primary') ?? body.querySelector<HTMLElement>('button'))?.focus();
    },
    close,
  };
}
