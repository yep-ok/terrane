// Pure table logic (no React / OpenLayers): filtering, sorting, statistics,
// clause building and value parsing. Unit-tested in logic.test.ts.
import type { Feat, Field, FieldType } from '../../core/types';
import { compileExpr, compileWhere } from '../../core/expr';
import { coerce } from '../../core/data';
import { fieldRef } from '../../core/store';

export type SortDir = 'asc' | 'desc';
export interface SortSpec {
  field: string;
  dir: SortDir;
}

export const isNumericType = (t: FieldType) => t === 'number' || t === 'integer';

export function isNullish(v: any): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v));
}

// ---------- rows ----------

/** Features passing a where-clause (all of them when the clause is empty or invalid). */
export function filterByWhere(features: Feat[], where?: string): Feat[] {
  if (!where || !where.trim()) return features;
  let pred: (f: Feat) => boolean;
  try {
    pred = compileWhere(where);
  } catch {
    return features;
  }
  return features.filter(pred);
}

/** Substring search (case-insensitive) across every field. */
export function searchFeatures(features: Feat[], fields: Field[], text: string): Feat[] {
  const t = text.trim().toLowerCase();
  if (!t) return features;
  const names = fields.map((f) => f.name);
  return features.filter((f) => {
    for (const n of names) {
      const v = f.properties[n];
      if (v === null || v === undefined) continue;
      if (String(v).toLowerCase().includes(t)) return true;
    }
    return false;
  });
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sortKey(v: any, type: FieldType): number | string | null {
  if (isNullish(v)) return null;
  if (isNumericType(type)) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return v ? 1 : 0;
  return String(v);
}

/** Stable sort by one field. Null/empty values always come last, whichever the direction. */
export function sortFeatures(features: Feat[], spec: SortSpec | null, type: FieldType): Feat[] {
  if (!spec) return features;
  const keyed: Array<{ f: Feat; k: number | string }> = [];
  const nulls: Feat[] = [];
  for (const f of features) {
    const k = sortKey(f.properties[spec.field], type);
    if (k === null) nulls.push(f);
    else keyed.push({ f, k });
  }
  const sign = spec.dir === 'asc' ? 1 : -1;
  const numeric = typeof keyed[0]?.k === 'number';
  keyed.sort(
    numeric
      ? (a, b) => sign * ((a.k as number) - (b.k as number))
      : (a, b) => sign * collator.compare(String(a.k), String(b.k)),
  );
  const out = keyed.map((x) => x.f);
  return nulls.length ? out.concat(nulls) : out;
}

export function uniqueValues(features: Feat[], field: string, limit = 200): string[] {
  const set = new Set<string>();
  for (const f of features) {
    const v = f.properties[field];
    if (isNullish(v)) continue;
    set.add(String(v));
    if (set.size > limit * 5) break;
  }
  return [...set].sort((a, b) => collator.compare(a, b)).slice(0, limit);
}

// ---------- display and editing ----------

export function formatCell(v: any, type: FieldType): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    const s = String(v);
    return s.length > 12 ? String(Number(v.toPrecision(10))) : s;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (type === 'date' && typeof v === 'string') return v.replace(/T00:00:00(\.0+)?Z?$/, '');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export type ParseResult = { ok: true; value: any } | { ok: false; error: string };

/** Parse text typed into a cell for a field type. Empty text means null. */
export function parseEdit(text: string, type: FieldType): ParseResult {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(t);
      if (!Number.isFinite(n)) return { ok: false, error: `"${t}" is not a number` };
      if (type === 'integer' && !Number.isInteger(n)) return { ok: false, error: `"${t}" is not a whole number` };
      return { ok: true, value: n };
    }
    case 'boolean':
      if (/^(true|1|yes|y|t)$/i.test(t)) return { ok: true, value: true };
      if (/^(false|0|no|n|f)$/i.test(t)) return { ok: true, value: false };
      return { ok: false, error: `"${t}" is not true or false` };
    case 'date':
      if (Number.isNaN(Date.parse(t))) return { ok: false, error: `"${t}" is not a valid date (use YYYY-MM-DD)` };
      return { ok: true, value: t };
    default:
      return { ok: true, value: text };
  }
}

// ---------- statistics ----------

export interface HistBin {
  x0: number;
  x1: number;
  n: number;
}
export interface Stats {
  count: number;
  nulls: number;
  sum: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  /** Population standard deviation. */
  stdDev: number;
  bins: HistBin[];
}

export function computeStats(values: Iterable<any>, binCount?: number): Stats | null {
  const nums: number[] = [];
  let total = 0;
  for (const v of values) {
    total++;
    if (isNullish(v)) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) nums.push(n);
  }
  const count = nums.length;
  if (!count) return null;
  nums.sort((a, b) => a - b);
  let sum = 0;
  for (const n of nums) sum += n;
  const mean = sum / count;
  let sq = 0;
  for (const n of nums) sq += (n - mean) ** 2;
  const mid = count >> 1;
  const median = count % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
  const min = nums[0];
  const max = nums[count - 1];
  const k = binCount ?? Math.max(5, Math.min(30, Math.ceil(Math.log2(count) + 1)));
  const bins: HistBin[] = [];
  if (min === max) bins.push({ x0: min, x1: max, n: count });
  else {
    const w = (max - min) / k;
    for (let i = 0; i < k; i++) bins.push({ x0: min + i * w, x1: i === k - 1 ? max : min + (i + 1) * w, n: 0 });
    for (const n of nums) bins[Math.min(k - 1, Math.floor((n - min) / w))].n++;
  }
  return { count, nulls: total - count, sum, mean, median, min, max, stdDev: Math.sqrt(sq / count), bins };
}

// ---------- clause builder (Select By Attributes) ----------

export type ClauseOp = 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge' | 'contains' | 'starts' | 'ends' | 'null' | 'notnull';
export interface Clause {
  id: number;
  field: string;
  op: ClauseOp;
  value: string;
}

const ALL_OPS: Array<{ value: ClauseOp; label: string }> = [
  { value: 'eq', label: 'is equal to' },
  { value: 'ne', label: 'is not equal to' },
  { value: 'lt', label: 'is less than' },
  { value: 'le', label: 'is at most' },
  { value: 'gt', label: 'is greater than' },
  { value: 'ge', label: 'is at least' },
  { value: 'contains', label: 'contains' },
  { value: 'starts', label: 'starts with' },
  { value: 'ends', label: 'ends with' },
  { value: 'null', label: 'is null' },
  { value: 'notnull', label: 'is not null' },
];

export function opsFor(type: FieldType): Array<{ value: ClauseOp; label: string }> {
  if (isNumericType(type)) return ALL_OPS.filter((o) => !['contains', 'starts', 'ends'].includes(o.value));
  if (type === 'boolean') return ALL_OPS.filter((o) => ['eq', 'ne', 'null', 'notnull'].includes(o.value));
  return ALL_OPS;
}
export const opNeedsValue = (op: ClauseOp) => op !== 'null' && op !== 'notnull';

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Expression literal for text typed in the value box, according to the field type. */
export function literal(value: string, type: FieldType): string {
  const t = value.trim();
  if (isNumericType(type) && t !== '' && Number.isFinite(Number(t))) return String(Number(t));
  if (type === 'boolean' && /^(true|false)$/i.test(t)) return t.toLowerCase();
  return quote(value);
}

export function clauseToExpr(c: Clause, type: FieldType): string {
  const f = fieldRef(c.field);
  switch (c.op) {
    case 'null':
      return `${f} IS NULL`;
    case 'notnull':
      return `${f} IS NOT NULL`;
    case 'contains':
      return `${f} LIKE ${quote(`%${c.value}%`)}`;
    case 'starts':
      return `${f} LIKE ${quote(`${c.value}%`)}`;
    case 'ends':
      return `${f} LIKE ${quote(`%${c.value}`)}`;
    default: {
      const sym = { eq: '=', ne: '<>', lt: '<', le: '<=', gt: '>', ge: '>=' }[c.op];
      return `${f} ${sym} ${literal(c.value, type)}`;
    }
  }
}

/** Join clauses into one expression. Clauses missing a required value or field are skipped. */
export function clausesToExpr(clauses: Clause[], typeOf: (field: string) => FieldType | undefined, joiner: 'AND' | 'OR'): string {
  const parts: string[] = [];
  for (const c of clauses) {
    const type = typeOf(c.field);
    if (!c.field || !type) continue;
    if (opNeedsValue(c.op) && c.value === '') continue;
    parts.push(clauseToExpr(c, type));
  }
  return parts.join(` ${joiner} `);
}

// ---------- calculation ----------

/** Evaluate an expression over features and coerce the results to a field type. */
export function evaluateCalc(features: Feat[], expr: string, type: FieldType): Map<number, any> {
  const fn = compileExpr(expr);
  const out = new Map<number, any>();
  for (const f of features) out.set(f.id, coerce(fn(f), type));
  return out;
}

/** Is `name` a legal new field name (non-empty, unique ignoring case)? */
export function fieldNameError(name: string, existing: string[]): string | null {
  const n = name.trim();
  if (!n) return 'Name is required';
  if (/[\[\]]/.test(n)) return 'Name cannot contain [ or ]';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `"${n}" already exists`;
  return null;
}
