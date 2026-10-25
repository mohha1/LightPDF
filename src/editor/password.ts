import { h } from '../ui/dom';

/**
 * Asks for the password of a protected PDF. A wrong password keeps the dialog
 * open with a note; resolves true once `check` accepts one, false on Cancel.
 */
export function askPassword(name: string, check: (password: string) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const input = h('input', {
      class: 'input',
      id: 'pdf-password',
      type: 'password',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    const note = h('p', { class: 'dialog-line password-wrong', role: 'alert', hidden: true }, 'Wrong password. Try again.');

    const close = (result: boolean) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(result);
    };
    const submit = () => {
      if (check(input.value)) return close(true);
      note.hidden = false;
      input.select();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
      } else if (event.key === 'Enter' && event.target === input) {
        event.preventDefault();
        submit();
      }
    };

    const dialog = h(
      'div',
      { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'password-title' },
      h('h2', { id: 'password-title' }, 'Password needed'),
      h('p', { class: 'dialog-line' }, `${name} is protected with a password. LightPDF keeps an unlocked copy while you work; the file on your computer stays as it is.`),
      h('div', { class: 'field' }, h('label', { class: 'field-label', for: input.id }, 'Password'), input),
      note,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { type: 'button', class: 'btn btn-light', onclick: () => close(false) }, 'Cancel'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: submit }, 'Open'),
      ),
    );
    const backdrop = h('div', { class: 'dialog-backdrop' }, dialog);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey, true);
    input.focus();
  });
}
