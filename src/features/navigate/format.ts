// Attribute value formatting for the identify pop-up (pure).
import type { FieldType } from '../../core/types';

export type Formatted = { kind: 'null' } | { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

const IDENT = /(^|[_\s])(id|fid|oid|objectid|code|zip|zipcode|postcode|postal|fips|year|yr|phone|no|num|number)$|^(id|fid|oid|objectid)/i;
const GEO = /^(lat|lon|lng|long|latitude|longitude|x|y)$/i;
const URL_RE = /^https?:\/\/[^\s]+$/i;

export function formatValue(value: unknown, field?: { name: string; type: FieldType }, locale?: string): Formatted {
  if (value === null || value === undefined || value === '') return { kind: 'null' };
  if (typeof value === 'boolean') return { kind: 'text', text: value ? 'Yes' : 'No' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { kind: 'text', text: String(value) };
    const name = field?.name ?? '';
    if (Number.isInteger(value)) {
      return { kind: 'text', text: IDENT.test(name) ? String(value) : value.toLocaleString(locale) };
    }
    const digits = GEO.test(name) ? 6 : Math.abs(value) >= 1000 ? 2 : 4;
    return { kind: 'text', text: value.toLocaleString(locale, { maximumFractionDigits: digits }) };
  }
  if (typeof value === 'string') {
    if (field?.type === 'date') {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) {
        const hasTime = /[T ]\d{2}:\d{2}/.test(value);
        return {
          kind: 'text',
          text: hasTime ? d.toLocaleString(locale) : d.toLocaleDateString(locale, { timeZone: 'UTC' }),
        };
      }
    }
    if (URL_RE.test(value.trim())) return { kind: 'link', text: value.trim(), href: value.trim() };
    return { kind: 'text', text: value };
  }
  if (value instanceof Date) return { kind: 'text', text: value.toLocaleString(locale) };
  try {
    return { kind: 'text', text: JSON.stringify(value) };
  } catch {
    return { kind: 'text', text: String(value) };
  }
}
