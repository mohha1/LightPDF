export type Value = string | number | boolean;
export type Values = Record<string, Value>;

export interface Choice {
  value: string;
  label: string;
  description?: string;
}

interface FieldBase {
  key: string;
  label?: string;
  /** Extra guidance under the field. */
  help?: string;
  /** Hides the field unless this returns true. */
  showIf?: (values: Values) => boolean;
}

export type Field =
  | (FieldBase & { type: 'section' })
  | (FieldBase & { type: 'choice'; choices: Choice[]; default: string })
  | (FieldBase & { type: 'select'; choices: Choice[]; default: string })
  | (FieldBase & { type: 'text'; placeholder?: string; default: string })
  | (FieldBase & { type: 'number'; min?: number; max?: number; step?: number; default: number })
  | (FieldBase & { type: 'range'; min: number; max: number; step: number; unit?: string; default: number })
  | (FieldBase & { type: 'checkbox'; default: boolean; disabled?: boolean })
  | (FieldBase & { type: 'color'; default: string })
  | (FieldBase & { type: 'position'; default: string });
