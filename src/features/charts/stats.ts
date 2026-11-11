// Pure statistics, binning, tick and aggregation helpers for the charts module.
// No React / DOM / OpenLayers imports: everything here is unit-testable in node.

export type Agg = 'count' | 'sum' | 'mean' | 'min' | 'max';

// ---------- descriptive statistics ----------

export const sum = (v: number[]): number => {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i];
  return s;
};
export const mean = (v: number[]): number => (v.length ? sum(v) / v.length : NaN);

/** Quantile of an ascending-sorted array (linear interpolation, "type 7"). */
export function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (!n) return NaN;
  if (n === 1) return sorted[0];
  const pos = Math.min(1, Math.max(0, p)) * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const ascending = (a: number, b: number) => a - b;

export function median(v: number[]): number {
  return quantileSorted([...v].sort(ascending), 0.5);
}

/** Sample standard deviation (n - 1). 0 for fewer than two values. */
export function stdDev(v: number[]): number {
  if (v.length < 2) return 0;
  const m = mean(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (v.length - 1));
}

export interface Summary {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  std: number;
  sum: number;
}
export function summarize(v: number[]): Summary {
  if (!v.length) return { n: 0, min: NaN, max: NaN, mean: NaN, median: NaN, std: NaN, sum: 0 };
  const sorted = [...v].sort(ascending);
  return { n: v.length, min: sorted[0], max: sorted[sorted.length - 1], mean: mean(v), median: quantileSorted(sorted, 0.5), std: stdDev(v), sum: sum(v) };
}

export interface BoxStats {
  n: number;
  min: number;
  max: number;
  q1: number;
  median: number;
  q3: number;
  /** Smallest / largest observation within 1.5 IQR of the quartiles. */
  lowerWhisker: number;
  upperWhisker: number;
  mean: number;
}

/** Tukey box-plot statistics; `outliers` are indices into the input of values beyond the whiskers. */
export function boxStats(values: number[], k = 1.5): { stats: BoxStats; outliers: number[] } {
  const n = values.length;
  if (!n) return { stats: { n: 0, min: NaN, max: NaN, q1: NaN, median: NaN, q3: NaN, lowerWhisker: NaN, upperWhisker: NaN, mean: NaN }, outliers: [] };
  const sorted = [...values].sort(ascending);
  const q1 = quantileSorted(sorted, 0.25);
  const med = quantileSorted(sorted, 0.5);
  const q3 = quantileSorted(sorted, 0.75);
  const iqr = q3 - q1;
  const lo = q1 - k * iqr;
  const hi = q3 + k * iqr;
  let lw = Infinity;
  let uw = -Infinity;
  for (const v of sorted) {
    if (v >= lo && v <= hi) {
      if (v < lw) lw = v;
      if (v > uw) uw = v;
    }
  }
  if (lw === Infinity) {
    lw = q1;
    uw = q3;
  }
  const outliers: number[] = [];
  for (let i = 0; i < n; i++) if (values[i] < lo || values[i] > hi) outliers.push(i);
  return { stats: { n, min: sorted[0], max: sorted[n - 1], q1, median: med, q3, lowerWhisker: lw, upperWhisker: uw, mean: mean(values) }, outliers };
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  n: number;
}
/** Ordinary least squares y = slope * x + intercept. Null when x has no variance or n < 2. */
export function linearRegression(xs: ArrayLike<number>, ys: ArrayLike<number>): Regression | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

// ---------- aggregation ----------

/** Aggregate numbers. `count` counts the entries passed in. Empty input: 0 for count/sum, NaN otherwise. */
export function aggregate(values: number[], agg: Agg): number {
  switch (agg) {
    case 'count':
      return values.length;
    case 'sum':
      return sum(values);
    case 'mean':
      return mean(values);
    case 'min': {
      let m = Infinity;
      for (const v of values) if (v < m) m = v;
      return values.length ? m : NaN;
    }
    case 'max': {
      let m = -Infinity;
      for (const v of values) if (v > m) m = v;
      return values.length ? m : NaN;
    }
  }
}

/** Group items by key, preserving first-appearance order. */
export function groupBy<T>(items: Iterable<T>, key: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const arr = out.get(k);
    if (arr) arr.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/** Natural, locale-aware comparison ("a2" < "a10"). */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ---------- binning ----------

export interface Bin<T = number> {
  x0: number;
  x1: number;
  items: T[];
}

/**
 * Equal-width histogram over [min, max] of the given values (the last bin is closed on the right).
 * Items keep their identity so callers can map bins back to features.
 */
export function histogram<T>(items: T[], value: (t: T) => number, binCount: number): Bin<T>[] {
  const n = Math.max(1, Math.floor(binCount));
  if (!items.length) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const it of items) {
    const v = value(it);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === hi) {
    const pad = lo === 0 ? 0.5 : Math.abs(lo) * 0.05;
    lo -= pad;
    hi += pad;
  }
  const width = (hi - lo) / n;
  const bins: Bin<T>[] = Array.from({ length: n }, (_, i) => ({ x0: lo + i * width, x1: i === n - 1 ? hi : lo + (i + 1) * width, items: [] }));
  for (const it of items) {
    const i = Math.min(n - 1, Math.max(0, Math.floor((value(it) - lo) / width)));
    bins[i].items.push(it);
  }
  return bins;
}

/** Sturges' rule, clamped to a pleasant range. */
export function suggestBinCount(n: number): number {
  if (n < 2) return 5;
  return Math.max(5, Math.min(40, Math.ceil(Math.log2(n)) + 1));
}

// ---------- ticks ----------

function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / Math.pow(10, exp);
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * Math.pow(10, exp);
}

export interface Ticks {
  ticks: number[];
  /** Nice domain that contains the data (multiples of step). */
  min: number;
  max: number;
  step: number;
}

/** "Nice" axis ticks (1/2/5 x 10^k). With `extend` the domain grows to the outer ticks. */
export function niceTicks(min: number, max: number, target = 6, extend = true): Ticks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1, step: 1 };
  if (min > max) [min, max] = [max, min];
  if (min === max) {
    const pad = min === 0 ? 1 : Math.abs(min) * 0.5;
    min -= pad;
    max += pad;
  }
  const step = niceNum(niceNum(max - min, false) / Math.max(1, target - 1), true);
  const first = Math.ceil(min / step - 1e-9) * step;
  const nMin = extend ? Math.floor(min / step + 1e-9) * step : min;
  const nMax = extend ? Math.ceil(max / step - 1e-9) * step : max;
  const ticks: number[] = [];
  for (let t = extend ? nMin : first; t <= nMax + step * 1e-9; t += step) ticks.push(round(t, step));
  return { ticks, min: nMin, max: nMax, step };
}

function round(v: number, step: number): number {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  return Number(v.toFixed(Math.min(d, 12)));
}

const DAY = 86400000;
const HOUR = 3600000;

/** Calendar-aligned ticks for a time axis (milliseconds since epoch, UTC). */
export function timeTicks(min: number, max: number, target = 6): Ticks {
  if (min === max) {
    min -= DAY / 2;
    max += DAY / 2;
  }
  const span = max - min;
  const ticks: number[] = [];
  if (span > 2.5 * 365 * DAY) {
    const y0 = new Date(min).getUTCFullYear();
    const y1 = new Date(max).getUTCFullYear();
    const step = niceNum((y1 - y0 || 1) / Math.max(1, target - 1), true);
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) ticks.push(Date.UTC(y, 0, 1));
    return finishTime(ticks, min, max, span / Math.max(1, ticks.length - 1), target);
  }
  if (span > 75 * DAY) {
    const months = span / (30.44 * DAY);
    const step = [1, 2, 3, 6, 12].find((s) => months / s <= target) ?? 12;
    const d0 = new Date(min);
    let y = d0.getUTCFullYear();
    let m = Math.floor(d0.getUTCMonth() / step) * step;
    for (let guard = 0; guard < 400; guard++) {
      const t = Date.UTC(y, m, 1);
      if (t > max) break;
      if (t >= min) ticks.push(t);
      m += step;
      if (m >= 12) {
        y += Math.floor(m / 12);
        m %= 12;
      }
    }
    return finishTime(ticks, min, max, step * 30.44 * DAY, target);
  }
  const steps = [HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY];
  const step = steps.find((s) => span / s <= target) ?? 14 * DAY;
  for (let t = Math.ceil(min / step) * step; t <= max; t += step) ticks.push(t);
  return finishTime(ticks, min, max, step, target);
}
function finishTime(ticks: number[], min: number, max: number, step: number, _target: number): Ticks {
  if (ticks.length < 2) return { ticks: [min, max], min, max, step: max - min };
  return { ticks, min, max, step };
}

/** Format a time-axis tick according to the step between ticks. */
export function formatTime(ms: number, step: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const iso = d.toISOString();
  if (step >= 300 * DAY) return iso.slice(0, 4);
  if (step >= 25 * DAY) return iso.slice(0, 7);
  if (step >= DAY) return iso.slice(0, 10);
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

// ---------- number formatting ----------

/** Fraction digits needed to print multiples of `step` exactly. */
export function decimalsFor(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.min(8, Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));
}

/** Compact axis-tick label: 1,200 / 2.5M / 0.25. */
export function formatTick(v: number, step = 1): string {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e6) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
  if (a !== 0 && a < 1e-4) return v.toExponential(1);
  return v.toLocaleString('en-US', { maximumFractionDigits: decimalsFor(step), minimumFractionDigits: 0 });
}

/** General value formatting for tooltips and tables. */
export function formatValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  if (a >= 1e15 || (a !== 0 && a < 1e-4)) return v.toExponential(2);
  return v.toLocaleString('en-US', { maximumFractionDigits: a >= 100 ? 1 : a >= 1 ? 2 : 4 });
}

export const formatPercent = (frac: number) => `${(frac * 100).toLocaleString('en-US', { maximumFractionDigits: frac < 0.1 ? 1 : 0 })}%`;

/** Shorten a label to at most `max` characters with an ellipsis. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(1, max - 1))}…`;
}

// ---------- scales ----------

export interface LinearScale {
  (v: number): number;
  invert(px: number): number;
  domain: [number, number];
  range: [number, number];
}
export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  const f = ((v: number) => r0 + (v - d0) * k) as LinearScale;
  f.invert = (px) => (k === 0 ? d0 : d0 + (px - r0) / k);
  f.domain = domain;
  f.range = range;
  return f;
}

/** Parse a field value to a number (null when it is not numeric). Dates become epoch milliseconds. */
export function toNumber(v: unknown, isDate = false): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;
  if (isDate) {
    const t = Date.parse(String(v));
    return Number.isNaN(t) ? null : t;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
