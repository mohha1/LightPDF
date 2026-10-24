import { PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, type PDFDocument } from 'pdf-lib';
import type { FieldValues } from './marks';

/**
 * Fills in a PDF's own form fields, by their full names, and redraws them so
 * the values also show on pages copied into another document. Fields that
 * don't exist, buttons and signatures are left alone.
 */
export function fillFields(doc: PDFDocument, values: FieldValues): void {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const form = doc.getForm();
  for (const [name, value] of entries) {
    const field = form.getFieldMaybe(name);
    if (!field || field.isReadOnly()) continue;
    try {
      if (field instanceof PDFTextField) {
        field.setText(typeof value === 'string' && value ? value : undefined);
      } else if (field instanceof PDFCheckBox) {
        if (value === true) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) selectRadio(field, value);
        else field.clear();
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value) field.select(value);
        else field.clear();
      } else if (field instanceof PDFOptionList) {
        const chosen = Array.isArray(value) ? [...value] : typeof value === 'string' && value ? [value] : [];
        if (chosen.length) field.select(chosen);
        else field.clear();
      }
    } catch {
      throw new Error(`The form field "${name}" couldn't take that value.`);
    }
  }
  try {
    form.updateFieldAppearances();
  } catch {
    throw new Error('Form fields can only be filled in with Latin letters, digits and common symbols.');
  }
}

/** Selects a radio button by the name PDF.js reports for it, which isn't always pdf-lib's option name. */
function selectRadio(field: PDFRadioGroup, value: string): void {
  const options = field.getOptions();
  if (options.includes(value)) return field.select(value);
  const onValues = field.acroField.getOnValues().map((name) => name.decodeText());
  const index = onValues.indexOf(value);
  if (index < 0 || !options[index]) throw new Error(`No option ${value}`);
  field.select(options[index]);
}
