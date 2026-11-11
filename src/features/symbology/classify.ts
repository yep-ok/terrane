// Classification maths for graduated / unique-value renderers. Pure functions (no DOM, no OL).
import { ckmeans } from 'simple-statistics';
import type { ClassMethod, RangeClass, SymbolDef } from '../../core/types';

export const MAX_UNIQUE_CLASSES = 200;
const NULL_LABEL = '<Null>';

type Props = Record<string, any> | null | undefined;

/** Numeric value of a field, optionally divided by a normalisation field. null when missing / invalid. */
export function numericValue(props: Props, field: string, normField?: string): number | null {
  const raw = props?.[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const v = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(v)) return null;
  if (!normField) return v;
  const dRaw = props?.[normField];
  if (dRaw === null || dRaw === undefined || dRaw === '') return null;
  const d = typeof dRaw === 'number' ? dRaw : Number(dRaw);
  if (!Number.isFinite(d) || d === 0) return null;
  const q = v / d;
  return Number.isFinite(q) ? q : null;
}

/** All finite numeric values of a field across features. */
export function collectNumbers(features: Array<{ properties: Props }>, field: string, normField?: string): number[] {
  const out: number[] = [];
  for (const f of features) {
    const v = numericValue(f.properties, field, normField);
    if (v !== null) out.push(v);
  }
  return out;
}

export interface Breaks {
  min: number;
  max: number;
  /** Ascending class upper bounds; the last equals max (rounded up for display). */
  uppers: number[];
}

function sortedFinite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/** Display precision suited to the span of the data and the class count. */
export function decimalsFor(min: number, max: number, n: number): number {
  const span = max - min;
  if (!(span > 0)) return 0;
  const step = span / Math.max(1, n);
  return Math.max(0, Math.min(6, 1 - Math.floor(Math.log10(step))));
}

const round = (v: number, dec: number) => {
  const p = 10 ** dec;
  return Math.round(v * p) / p;
};

/** Strictly increasing upper bounds that cover [min,max]; collapses duplicates. */
function finish(min: number, max: number, raw: number[], n: number): Breaks {
  const dec = decimalsFor(min, max, n);
  const p = 10 ** dec;
  const lo = Math.floor(min * p) / p;
  const hi = Math.ceil(max * p) / p;
  const uppers: number[] = [];
  for (const b of raw) {
    const r = round(b, dec);
    if (r <= lo || r >= hi) continue;
    if (uppers.length && r <= uppers[uppers.length - 1]) continue;
    uppers.push(r);
  }
  uppers.push(hi);
  return { min: lo, max: hi, uppers };
}

export function equalInterval(values: number[], n: number): Breaks {
  const v = sortedFinite(values);
  if (!v.length) return { min: 0, max: 0, uppers: [0] };
  const min = v[0];
  const max = v[v.length - 1];
  const raw = Array.from({ length: Math.max(0, n - 1) }, (_, i) => min + ((max - min) * (i + 1)) / n);
  return finish(min, max, raw, n);
}

export function quantile(values: number[], n: number): Breaks {
  const v = sortedFinite(values);
  if (!v.length) return { min: 0, max: 0, uppers: [0] };
  const raw: number[] = [];
  for (let i = 1; i < n; i++) {
    const pos = (v.length * i) / n;
    const idx = Math.min(v.length - 1, Math.max(0, Math.ceil(pos) - 1));
    raw.push(v[idx]);
  }
  return finish(v[0], v[v.length - 1], raw, n);
}

export function naturalBreaks(values: number[], n: number): Breaks {
  let v = sortedFinite(values);
  if (!v.length) return { min: 0, max: 0, uppers: [0] };
  const min = v[0];
  const max = v[v.length - 1];
  const distinct = new Set(v).size;
  const k = Math.min(n, distinct);
  if (k < 2) return finish(min, max, [], n);
  if (v.length > 8000) {
    // ckmeans is O(k n log n); sample evenly (keeping extremes) for very large datasets.
    const step = v.length / 8000;
    const sample: number[] = [];
    for (let i = 0; i < 8000; i++) sample.push(v[Math.floor(i * step)]);
    sample[sample.length - 1] = max;
    v = sample;
  }
  const kk = Math.min(k, new Set(v).size);
  if (kk < 2) return finish(min, max, [], n);
  const clusters = ckmeans(v, kk);
  const raw = clusters.slice(0, -1).map((c) => c[c.length - 1]);
  return finish(min, max, raw, n);
}

export function standardDeviation(values: number[], n: number): Breaks {
  const v = sortedFinite(values);
  if (!v.length) return { min: 0, max: 0, uppers: [0] };
  const min = v[0];
  const max = v[v.length - 1];
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  if (!(sd > 0)) return finish(min, max, [], n);
  const step = n >= 8 ? sd / 2 : sd;
  const raw = Array.from({ length: Math.max(0, n - 1) }, (_, i) => mean + (i + 1 - n / 2) * step);
  return finish(min, max, raw, n);
}

export function computeBreaks(values: number[], method: ClassMethod, n: number): Breaks {
  switch (method) {
    case 'quantile': return quantile(values, n);
    case 'jenks': return naturalBreaks(values, n);
    case 'stddev': return standardDeviation(values, n);
    default: return equalInterval(values, n);
  }
}

// ---------- labels & classes ----------

export function formatNumber(n: number, dec: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Decimals needed to show every bound exactly (capped) — used when labelling manual breaks. */
export function labelDecimals(bounds: number[]): number {
  let dec = 0;
  for (const b of bounds) {
    let d = 0;
    while (d < 6 && Math.abs(b - round(b, d)) >= 1e-9) d++;
    dec = Math.max(dec, d);
  }
  return dec;
}

export function rangeLabel(min: number, max: number, dec: number): string {
  return `${formatNumber(min, dec)} – ${formatNumber(max, dec)}`;
}

/** Build classes from breaks, one symbol per class. */
export function rangeClasses(b: Breaks, symbols: SymbolDef[]): RangeClass[] {
  const dec = labelDecimals([b.min, ...b.uppers]);
  let lo = b.min;
  return b.uppers.map((hi, i) => {
    const c: RangeClass = { min: lo, max: hi, label: rangeLabel(lo, hi, dec), symbol: symbols[Math.min(i, symbols.length - 1)] };
    lo = hi;
    return c;
  });
}

/** Re-label classes after their bounds were edited (keeps symbols). Bounds stay contiguous. */
export function relabel(classes: RangeClass[]): RangeClass[] {
  if (!classes.length) return classes;
  const dec = labelDecimals([classes[0].min, ...classes.map((c) => c.max)]);
  return classes.map((c) => ({ ...c, label: rangeLabel(c.min, c.max, dec) }));
}

/** Set class i's upper bound; neighbours stay contiguous and bounds stay ordered. */
export function setUpperBound(classes: RangeClass[], i: number, value: number): RangeClass[] {
  const lo = classes[i].min;
  const hi = i + 1 < classes.length ? classes[i + 1].max : Infinity;
  let v = value;
  if (i + 1 < classes.length) v = Math.min(Math.max(v, lo), hi);
  else v = Math.max(v, lo);
  const next = classes.map((c, j) => (j === i ? { ...c, max: v } : j === i + 1 ? { ...c, min: v } : c));
  return relabel(next);
}

// ---------- unique values ----------

export interface UniqueValue {
  value: string; // '' for null / empty
  count: number;
}

export const uniqueKey = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Distinct values with counts, sorted (numerically when all are numbers). */
export function uniqueValues(features: Array<{ properties: Props }>, field: string, cap = MAX_UNIQUE_CLASSES): { values: UniqueValue[]; total: number } {
  const counts = new Map<string, number>();
  for (const f of features) {
    const k = uniqueKey(f.properties?.[field]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keys = [...counts.keys()];
  const nonEmpty = keys.filter((k) => k !== '');
  const numeric = nonEmpty.length > 0 && nonEmpty.every((k) => k.trim() !== '' && Number.isFinite(Number(k)));
  nonEmpty.sort(numeric ? (a, b) => Number(a) - Number(b) : (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (counts.has('')) nonEmpty.push('');
  const total = nonEmpty.length;
  return { values: nonEmpty.slice(0, cap).map((value) => ({ value, count: counts.get(value)! })), total };
}

export const uniqueLabel = (value: string) => (value === '' ? NULL_LABEL : value);

// ---------- histogram ----------

export interface Histogram {
  min: number;
  max: number;
  counts: number[];
}

export function histogram(values: number[], bins = 24): Histogram {
  const v = values.filter((x) => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 0, counts: [] };
  let min = Infinity;
  let max = -Infinity;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  const counts = new Array<number>(bins).fill(0);
  const span = max - min || 1;
  for (const x of v) counts[Math.min(bins - 1, Math.floor(((x - min) / span) * bins))]++;
  return { min, max, counts };
}

/** Class index for a value, or -1. Classes are contiguous; the first includes its min. */
export function classIndex(classes: RangeClass[], v: number): number {
  const n = classes.length;
  if (!n || v < classes[0].min || v > classes[n - 1].max) return -1;
  for (let i = 0; i < n; i++) if (v <= classes[i].max) return i;
  return -1;
}
