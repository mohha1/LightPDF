import type { Field, InputFile, Values } from '../tools/types';
import { h } from './dom';

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];

export interface OptionsPanel {
  element: HTMLElement;
  /** Re-applies `showIf` rules and dynamic help after values or files change. */
  refresh(): void;
}

/**
 * Renders a tool's fields. Edits write straight into `values`; the panel is
 * never rebuilt while typing, so inputs keep their focus.
 */
export function renderOptions(
  fields: Field[],
  values: Values,
  inputs: () => InputFile[],
  onChange: () => void,
): OptionsPanel {
  const rows: Array<{ field: Field; row: HTMLElement; help?: HTMLElement }> = [];

  const set = (key: string, value: Values[string]) => {
    values[key] = value;
    refresh();
    onChange();
  };

  for (const field of fields) {
    const id = `field-${field.key}`;
    const help = field.help ? h('p', { class: 'field-help' }) : undefined;
    const control = renderControl(field, id, values, set);
    const label =
      field.label && field.type !== 'checkbox'
        ? h(field.type === 'choice' || field.type === 'position' ? 'div' : 'label', { class: 'field-label', for: id }, field.label)
        : null;
    const row = h('div', { class: `field field-${field.type}` }, label, control, help);
    rows.push({ field, row, help });
  }

  function refresh() {
    for (const { field, row, help } of rows) {
      row.hidden = field.showIf ? !field.showIf(values) : false;
      if (help && field.help) {
        const text = typeof field.help === 'function' ? field.help(inputs(), values) : field.help;
        help.textContent = text;
        help.hidden = !text.trim();
      }
    }
  }

  refresh();
  return { element: h('div', { class: 'options' }, rows.map(({ row }) => row)), refresh };
}

function renderControl(
  field: Field,
  id: string,
  values: Values,
  set: (key: string, value: Values[string]) => void,
): HTMLElement {
  const value = values[field.key];

  switch (field.type) {
    case 'choice': {
      const buttons = field.choices.map((choice) =>
        h(
          'button',
          {
            type: 'button',
            class: 'choice',
            role: 'radio',
            'aria-checked': String(choice.value === value),
            onclick: (event: Event) => {
              const group = (event.currentTarget as HTMLElement).parentElement!;
              group.querySelectorAll('.choice').forEach((b) => b.setAttribute('aria-checked', 'false'));
              (event.currentTarget as HTMLElement).setAttribute('aria-checked', 'true');
              set(field.key, choice.value);
            },
          },
          h('span', { class: 'choice-label' }, choice.label),
          choice.description && h('span', { class: 'choice-description' }, choice.description),
        ),
      );
      const hasDescriptions = field.choices.some((choice) => choice.description);
      return h(
        'div',
        { class: `choices ${hasDescriptions ? 'choices-stacked' : ''}`, role: 'radiogroup', 'aria-label': field.label ?? field.key },
        buttons,
      );
    }

    case 'select':
      return h(
        'select',
        { id, class: 'input', onchange: (event: Event) => set(field.key, (event.target as HTMLSelectElement).value) },
        field.choices.map((choice) => h('option', { value: choice.value, selected: choice.value === value }, choice.label)),
      );

    case 'text':
      return h('input', {
        id,
        class: 'input',
        type: 'text',
        value: String(value ?? ''),
        placeholder: field.placeholder,
        autocomplete: 'off',
        oninput: (event: Event) => set(field.key, (event.target as HTMLInputElement).value),
      });

    case 'number':
      return h('input', {
        id,
        class: 'input',
        type: 'number',
        inputmode: 'numeric',
        value: String(value),
        min: field.min,
        max: field.max,
        step: field.step,
        oninput: (event: Event) => {
          const input = event.target as HTMLInputElement;
          if (input.value !== '') set(field.key, Number(input.value));
        },
      });

    case 'range': {
      const output = h('output', { for: id, class: 'range-value' }, `${value}${field.unit ?? ''}`);
      const input = h('input', {
        id,
        type: 'range',
        value: String(value),
        min: field.min,
        max: field.max,
        step: field.step,
        oninput: (event: Event) => {
          const next = Number((event.target as HTMLInputElement).value);
          output.textContent = `${next}${field.unit ?? ''}`;
          set(field.key, next);
        },
      });
      return h('div', { class: 'range' }, input, output);
    }

    case 'checkbox':
      return h(
        'label',
        { class: 'checkbox', for: id },
        h('input', {
          id,
          type: 'checkbox',
          checked: Boolean(value),
          onchange: (event: Event) => set(field.key, (event.target as HTMLInputElement).checked),
        }),
        h('span', {}, field.label ?? ''),
      );

    case 'color':
      return h(
        'div',
        { class: 'color' },
        h('input', {
          id,
          type: 'color',
          value: String(value),
          oninput: (event: Event) => set(field.key, (event.target as HTMLInputElement).value),
        }),
      );

    case 'position':
      return h(
        'div',
        { class: 'position-picker', role: 'radiogroup', 'aria-label': field.label ?? 'Position' },
        POSITIONS.map((position) =>
          h('button', {
            type: 'button',
            class: `position position-${position}`,
            role: 'radio',
            title: position.replace('-', ' '),
            'aria-label': position.replace('-', ' '),
            'aria-checked': String(position === value),
            onclick: (event: Event) => {
              const group = (event.currentTarget as HTMLElement).parentElement!;
              group.querySelectorAll('.position').forEach((b) => b.setAttribute('aria-checked', 'false'));
              (event.currentTarget as HTMLElement).setAttribute('aria-checked', 'true');
              set(field.key, position);
            },
          }),
        ),
      );
  }
}

export function defaultValues(fields: Field[]): Values {
  return Object.fromEntries(fields.map((field) => [field.key, field.default]));
}
