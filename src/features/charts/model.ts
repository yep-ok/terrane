// Turns features + a ChartConfig into a render-ready ChartModel. Pure (no React / DOM).
import type { Dataset, Feat, Renderer } from '../../core/types';
import { rampColors } from '../symbology/ramps';
import {
  AGG_LABELS, autoTitle, missingConfig, type ChartConfig,
} from './config';
import {
  aggregate, boxStats, formatValue, groupBy, histogram, linearRegression, naturalCompare, summarize, toNumber,
  type Agg, type BoxStats, type Regression, type Summary,
} from './stats';

export const OTHER_KEY = '\u0001other';
export const OTHER_COLOR = '#8b929b';
export const EMPTY_LABEL = '(empty)';

export interface ModelBase {
  /** Features that contributed to the chart / features considered. */
  used: number;
  total: number;
  /** Features skipped because a needed value was missing or invalid. */
  skipped: number;
  /** Notes shown under the chart ("12 values <= 0 omitted"). */
  notes: string[];
  title: string;
}

export interface Seg {
  series: string;
  value: number;
  /** Same aggregation over the selected members only (0 when none selected). */
  sel: number;
  count: number;
  selCount: number;
  fids: number[];
}
export interface BarCat {
  key: string;
  label: string;
  total: number;
  selTotal: number;
  count: number;
  selCount: number;
  fids: number[];
  color: string;
  segs: Seg[];
}
export interface SeriesInfo {
  key: string;
  label: string;
  color: string;
  fids: number[];
}
export interface BarModel extends ModelBase {
  kind: 'bar';
  cats: BarCat[];
  series: SeriesInfo[]; // empty when not split
  stacked: boolean;
  horizontal: boolean;
  valueTitle: string;
  catTitle: string;
}
export interface PieSlice {
  key: string;
  label: string;
  value: number;
  sel: number;
  count: number;
  selCount: number;
  fids: number[];
  color: string;
}
export interface PieModel extends ModelBase {
  kind: 'pie';
  slices: PieSlice[];
  /** Sum of the slice values. */
  sum: number;
  valueTitle: string;
}
export interface HBin {
  x0: number;
  x1: number;
  count: number;
  sel: number;
  fids: number[];
}
export interface HistModel extends ModelBase {
  kind: 'histogram';
  bins: HBin[];
  stats: Summary;
  log: boolean;
  /** Overlay positions in axis space (log10 when `log`); null when not representable. */
  meanX: number | null;
  medianX: number | null;
  stdX: [number, number] | null;
  xTitle: string;
}
export interface ScatterPoint {
  fid: number;
  x: number;
  y: number;
  g: number; // colour group index or -1
  s: number | null; // size value
  sel: boolean;
}
export interface ScatterModel extends ModelBase {
  kind: 'scatter';
  points: ScatterPoint[];
  groups: SeriesInfo[];
  trend: Regression | null;
  size: { min: number; max: number } | null;
  xTitle: string;
  yTitle: string;
}
export interface LinePoint {
  x: number;
  y: number;
  fids: number[];
  selCount: number;
}
export interface LineSeries {
  key: string;
  label: string;
  color: string;
  pts: LinePoint[];
}
export interface LineModel extends ModelBase {
  kind: 'line';
  series: LineSeries[];
  xIsDate: boolean;
  xTitle: string;
  yTitle: string;
}
export interface BoxItem {
  key: string;
  label: string;
  color: string;
  stats: BoxStats;
  outliers: Array<{ fid: number; v: number; sel: boolean }>;
  fids: number[];
  selCount: number;
}
export interface BoxModel extends ModelBase {
  kind: 'box';
  boxes: BoxItem[];
  horizontal: boolean;
  valueTitle: string;
  catTitle: string;
}
export interface Invalid {
  kind: 'invalid';
  message: string;
  detail?: string;
}
export type ChartModel = BarModel | PieModel | HistModel | ScatterModel | LineModel | BoxModel | Invalid;

// ---------- colour ----------

/** Colours for a list of keys according to the config's colour mode. `distinct` = keys must be told apart. */
export function resolveColors(cfg: ChartConfig, renderer: Renderer | undefined, field: string, keys: string[], distinct: boolean): string[] {
  const ramp = rampColors(cfg.ramp, Math.max(1, keys.length));
  return keys.map((k, i) => {
    if (k === OTHER_KEY) return OTHER_COLOR;
    if (cfg.colorMode === 'symbology' && renderer?.type === 'unique' && renderer.field === field) {
      const cls = renderer.classes.find((c) => c.value === k);
      return cls?.symbol.fill ?? renderer.defaultSymbol?.fill ?? OTHER_COLOR;
    }
    if (cfg.colorMode === 'single' && !distinct) return cfg.color;
    return ramp[i];
  });
}

/** True when the layer renderer is a unique-values renderer on one of the given fields. */
export function symbologyField(renderer: Renderer | undefined, fields: string[]): boolean {
  return renderer?.type === 'unique' && fields.includes(renderer.field);
}

// ---------- helpers ----------

const catKey = (v: unknown): string => (v === null || v === undefined || v === '' ? '' : v instanceof Date ? v.toISOString() : String(v));
const catLabel = (k: string) => (k === OTHER_KEY ? 'Other' : k === '' ? EMPTY_LABEL : k);
const isDateField = (ds: Dataset, name: string) => ds.fields.find((f) => f.name === name)?.type === 'date';

interface Item {
  fid: number;
  cat: string;
  ser: string;
  v: number;
  sel: boolean;
}

const aggTitle = (cfg: ChartConfig) => (cfg.agg === 'count' || !cfg.valueField ? 'Count' : `${AGG_LABELS[cfg.agg]} of ${cfg.valueField}`);

function base(cfg: ChartConfig, total: number, used: number, notes: string[] = []): ModelBase {
  return { used, total, skipped: total - used, notes, title: cfg.title.trim() || autoTitle(cfg) };
}

function makeSeg(items: Item[], agg: Agg, series: string): Seg {
  const vals: number[] = [];
  const selVals: number[] = [];
  const fids: number[] = [];
  for (const it of items) {
    vals.push(it.v);
    fids.push(it.fid);
    if (it.sel) selVals.push(it.v);
  }
  return { series, value: aggregate(vals, agg), sel: selVals.length ? aggregate(selVals, agg) : 0, count: items.length, selCount: selVals.length, fids };
}

/** Keep the `n` keys with the most weight; remap everything else to OTHER_KEY. */
function foldOther(keys: Map<string, number>, n: number): Set<string> | null {
  if (n <= 0 || keys.size <= n) return null;
  const keep = [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map((e) => e[0]);
  return new Set(keep);
}

interface CatBuild {
  cats: Array<{ key: string; label: string; items: Item[]; total: number }>;
  series: string[];
  used: number;
  /** Seg aggregation per cat (grouped by series). */
  segs: Map<string, Seg[]>;
}

/** Shared by bar, pie: group items into categories (top-N + Other), optionally split by a series. */
function buildCategories(feats: Feat[], cfg: ChartConfig, selected: Set<number>, split: string, topN: number): CatBuild {
  const agg = cfg.agg;
  const valDate = false;
  const items: Item[] = [];
  for (const f of feats) {
    let v = 1;
    if (agg !== 'count') {
      const n = toNumber(f.properties[cfg.valueField], valDate);
      if (n === null) continue;
      v = n;
    }
    items.push({ fid: f.id, cat: catKey(f.properties[cfg.category]), ser: split ? catKey(f.properties[split]) : '', v, sel: selected.has(f.id) });
  }

  // fold small categories into Other
  const weight = new Map<string, number>();
  for (const [k, g] of groupBy(items, (i) => i.cat)) weight.set(k, Math.abs(aggregate(g.map((i) => i.v), agg)) || g.length * 1e-9);
  const keep = foldOther(weight, topN);
  if (keep) for (const it of items) if (!keep.has(it.cat)) it.cat = OTHER_KEY;

  // cap series at 12
  if (split) {
    const sw = new Map<string, number>();
    for (const it of items) sw.set(it.ser, (sw.get(it.ser) ?? 0) + 1);
    const skeep = foldOther(sw, 11);
    if (skeep) for (const it of items) if (!skeep.has(it.ser)) it.ser = OTHER_KEY;
  }

  const catGroups = groupBy(items, (i) => i.cat);
  const cats = [...catGroups].map(([key, g]) => ({ key, label: catLabel(key), items: g, total: aggregate(g.map((i) => i.v), agg) }));
  const seriesOrder = split ? [...new Set(items.map((i) => i.ser))].sort((a, b) => (a === OTHER_KEY ? 1 : b === OTHER_KEY ? -1 : naturalCompare(catLabel(a), catLabel(b)))) : [''];

  const segs = new Map<string, Seg[]>();
  for (const c of cats) {
    const bySer = groupBy(c.items, (i) => i.ser);
    segs.set(c.key, seriesOrder.filter((s) => bySer.has(s)).map((s) => makeSeg(bySer.get(s)!, agg, s)));
  }
  return { cats, series: split ? seriesOrder : [], used: items.length, segs };
}

function sortCats<T extends { key: string; label: string; total: number }>(cats: T[], mode: ChartConfig['sort']): T[] {
  const out = [...cats];
  const rank = (c: T) => (c.key === OTHER_KEY ? 1 : 0);
  const cmp: Record<ChartConfig['sort'], (a: T, b: T) => number> = {
    'value-desc': (a, b) => b.total - a.total,
    'value-asc': (a, b) => a.total - b.total,
    label: (a, b) => naturalCompare(a.label, b.label),
    none: () => 0,
  };
  return out.sort((a, b) => rank(a) - rank(b) || cmp[mode](a, b));
}

// ---------- builders ----------

function buildBar(feats: Feat[], cfg: ChartConfig, selected: Set<number>, renderer: Renderer | undefined): ChartModel {
  const split = cfg.splitField && cfg.splitField !== cfg.category ? cfg.splitField : '';
  const b = buildCategories(feats, cfg, selected, split, cfg.topN);
  if (!b.cats.length) return { kind: 'invalid', message: 'Nothing to chart', detail: 'No features have both a category and a numeric value for the chosen fields.' };
  const stacked = !!split && cfg.splitMode === 'stacked' && (cfg.agg === 'count' || cfg.agg === 'sum');
  const sorted = sortCats(b.cats, cfg.sort);

  const catColors = split ? [] : resolveColors(cfg, renderer, cfg.category, sorted.map((c) => c.key), false);
  const serColors = split ? resolveColors(cfg, renderer, split, b.series, true) : [];
  const cats: BarCat[] = sorted.map((c, i) => {
    const segs = b.segs.get(c.key)!;
    const sel = c.items.filter((x) => x.sel);
    return {
      key: c.key,
      label: c.label,
      total: c.total,
      selTotal: sel.length ? aggregate(sel.map((x) => x.v), cfg.agg) : 0,
      count: c.items.length,
      selCount: sel.length,
      fids: c.items.map((x) => x.fid),
      color: catColors[i] ?? OTHER_COLOR,
      segs,
    };
  });
  const series: SeriesInfo[] = b.series.map((s, i) => ({ key: s, label: catLabel(s), color: serColors[i], fids: cats.flatMap((c) => c.segs.filter((g) => g.series === s).flatMap((g) => g.fids)) }));
  const notes: string[] = [];
  if (cfg.topN > 0 && cats.some((c) => c.key === OTHER_KEY)) notes.push(`Smaller categories combined as "Other" (top ${cfg.topN} shown).`);
  if (cfg.splitMode === 'stacked' && split && !stacked) notes.push('Stacking applies to Count and Sum only; bars are grouped.');
  return {
    kind: 'bar', cats, series, stacked, horizontal: cfg.orientation === 'horizontal',
    valueTitle: aggTitle(cfg), catTitle: cfg.category, ...base(cfg, feats.length, b.used, notes),
  };
}

function buildPie(feats: Feat[], cfg: ChartConfig, selected: Set<number>, renderer: Renderer | undefined): ChartModel {
  const b = buildCategories(feats, cfg, selected, '', cfg.topN);
  const positive = b.cats.filter((c) => c.total > 0);
  if (!positive.length) return { kind: 'invalid', message: 'Nothing to chart', detail: 'A pie chart needs categories with positive values.' };
  const sorted = sortCats(positive, cfg.sort);
  const colors = resolveColors(cfg, renderer, cfg.category, sorted.map((c) => c.key), true);
  const slices: PieSlice[] = sorted.map((c, i) => {
    const sel = c.items.filter((x) => x.sel);
    return {
      key: c.key, label: c.label, value: c.total, sel: sel.length ? aggregate(sel.map((x) => x.v), cfg.agg) : 0,
      count: c.items.length, selCount: sel.length, fids: c.items.map((x) => x.fid), color: colors[i],
    };
  });
  const notes: string[] = [];
  if (positive.length < b.cats.length) notes.push(`${b.cats.length - positive.length} categories with zero or negative totals omitted.`);
  if (cfg.topN > 0 && slices.some((s) => s.key === OTHER_KEY)) notes.push(`Smaller categories combined as "Other" (top ${cfg.topN} shown).`);
  return { kind: 'pie', slices, sum: slices.reduce((n, s) => n + s.value, 0), valueTitle: aggTitle(cfg), ...base(cfg, feats.length, b.used, notes) };
}

function buildHistogram(feats: Feat[], cfg: ChartConfig, selected: Set<number>, ds: Dataset): ChartModel {
  const date = isDateField(ds, cfg.field);
  const items: Array<{ fid: number; v: number; t: number }> = [];
  let nonPositive = 0;
  for (const f of feats) {
    const v = toNumber(f.properties[cfg.field], date);
    if (v === null) continue;
    if (cfg.logScale) {
      if (v <= 0) {
        nonPositive++;
        continue;
      }
      items.push({ fid: f.id, v, t: Math.log10(v) });
    } else items.push({ fid: f.id, v, t: v });
  }
  if (!items.length) return { kind: 'invalid', message: 'Nothing to chart', detail: `No numeric values in "${cfg.field}".` };
  const bins: HBin[] = histogram(items, (i) => i.t, cfg.bins).map((b) => {
    let sel = 0;
    for (const it of b.items) if (selected.has(it.fid)) sel++;
    return { x0: b.x0, x1: b.x1, count: b.items.length, sel, fids: b.items.map((i) => i.fid) };
  });
  const stats = summarize(items.map((i) => i.v));
  const tf = (v: number) => (cfg.logScale ? (v > 0 ? Math.log10(v) : null) : v);
  const lo = bins[0].x0;
  const hi = bins[bins.length - 1].x1;
  const inRange = (t: number | null) => (t !== null && t >= lo && t <= hi ? t : null);
  const stdLo = tf(stats.mean - stats.std);
  const stdHi = tf(stats.mean + stats.std);
  const notes: string[] = [];
  if (nonPositive) notes.push(`${nonPositive} values <= 0 omitted (log scale).`);
  return {
    kind: 'histogram', bins, stats, log: cfg.logScale,
    meanX: inRange(tf(stats.mean)), medianX: inRange(tf(stats.median)),
    stdX: stdLo !== null && stdHi !== null && stats.std > 0 ? [stdLo, stdHi] : null,
    xTitle: cfg.logScale ? `${cfg.field} (log scale)` : cfg.field,
    ...base(cfg, feats.length, items.length, notes),
  };
}

function buildScatter(feats: Feat[], cfg: ChartConfig, selected: Set<number>, ds: Dataset, renderer: Renderer | undefined): ChartModel {
  const xd = isDateField(ds, cfg.xField);
  const yd = isDateField(ds, cfg.yField);
  const raw: Array<{ f: Feat; x: number; y: number; s: number | null }> = [];
  for (const f of feats) {
    const x = toNumber(f.properties[cfg.xField], xd);
    const y = toNumber(f.properties[cfg.yField], yd);
    if (x === null || y === null) continue;
    raw.push({ f, x, y, s: cfg.sizeField ? toNumber(f.properties[cfg.sizeField]) : null });
  }
  if (!raw.length) return { kind: 'invalid', message: 'Nothing to chart', detail: `No features have numeric values in both "${cfg.xField}" and "${cfg.yField}".` };

  let groups: SeriesInfo[] = [];
  let groupOf = new Map<string, number>();
  if (cfg.colorField) {
    const counts = new Map<string, number>();
    for (const r of raw) {
      const k = catKey(r.f.properties[cfg.colorField]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const keep = foldOther(counts, 11);
    const keys = [...counts.keys()].filter((k) => !keep || keep.has(k)).sort((a, b) => naturalCompare(catLabel(a), catLabel(b)));
    if (keep) keys.push(OTHER_KEY);
    const colors = resolveColors(cfg, renderer, cfg.colorField, keys, true);
    groups = keys.map((k, i) => ({ key: k, label: catLabel(k), color: colors[i], fids: [] }));
    groupOf = new Map(keys.map((k, i) => [k, i]));
  }
  const points: ScatterPoint[] = raw.map((r) => {
    let g = -1;
    if (groups.length) {
      const k = catKey(r.f.properties[cfg.colorField]);
      g = groupOf.get(k) ?? groupOf.get(OTHER_KEY) ?? -1;
      if (g >= 0) groups[g].fids.push(r.f.id);
    }
    return { fid: r.f.id, x: r.x, y: r.y, g, s: r.s, sel: selected.has(r.f.id) };
  });
  let size: ScatterModel['size'] = null;
  if (cfg.sizeField) {
    let mn = Infinity;
    let mx = -Infinity;
    for (const p of points) if (p.s !== null) {
      if (p.s < mn) mn = p.s;
      if (p.s > mx) mx = p.s;
    }
    if (mn !== Infinity) size = { min: mn, max: mx };
  }
  const trend = cfg.trend ? linearRegression(points.map((p) => p.x), points.map((p) => p.y)) : null;
  return { kind: 'scatter', points, groups, trend, size, xTitle: cfg.xField, yTitle: cfg.yField, ...base(cfg, feats.length, points.length) };
}

function buildLine(feats: Feat[], cfg: ChartConfig, selected: Set<number>, ds: Dataset, renderer: Renderer | undefined): ChartModel {
  void renderer;
  const xd = isDateField(ds, cfg.xField);
  const ys = cfg.yFields.length ? cfg.yFields : [''];
  const colors = resolveColors({ ...cfg, colorMode: cfg.colorMode === 'symbology' ? 'ramp' : cfg.colorMode }, undefined, '', ys, ys.length > 1);
  const used = new Set<number>();
  const series: LineSeries[] = ys.map((y, si) => {
    const byX = new Map<number, Array<{ fid: number; v: number }>>();
    for (const f of feats) {
      const x = toNumber(f.properties[cfg.xField], xd);
      if (x === null) continue;
      let v = 1;
      if (y) {
        const n = toNumber(f.properties[y]);
        if (n === null) continue;
        v = n;
      }
      used.add(f.id);
      const arr = byX.get(x);
      if (arr) arr.push({ fid: f.id, v });
      else byX.set(x, [{ fid: f.id, v }]);
    }
    const agg: Agg = y ? cfg.agg : 'count';
    const pts: LinePoint[] = [...byX]
      .sort((a, b) => a[0] - b[0])
      .map(([x, g]) => ({ x, y: aggregate(g.map((i) => i.v), agg), fids: g.map((i) => i.fid), selCount: g.filter((i) => selected.has(i.fid)).length }))
      .filter((p) => Number.isFinite(p.y));
    return { key: y || '__count', label: y ? (cfg.agg === 'count' ? `Count of ${y}` : `${AGG_LABELS[cfg.agg]} of ${y}`) : 'Count', color: colors[si], pts };
  });
  if (!series.some((s) => s.pts.length)) return { kind: 'invalid', message: 'Nothing to chart', detail: `No features have numeric values for "${cfg.xField}" and the chosen Y fields.` };
  const yTitle = series.length === 1 ? series[0].label : cfg.agg === 'count' ? 'Count' : AGG_LABELS[cfg.agg];
  const repeated = series.some((s) => s.pts.some((p) => p.fids.length > 1));
  return {
    kind: 'line', series, xIsDate: xd, xTitle: cfg.xField, yTitle,
    ...base(cfg, feats.length, used.size, repeated ? [`Repeated X values are aggregated (${AGG_LABELS[cfg.agg].toLowerCase()}).`] : []),
  };
}

function buildBox(feats: Feat[], cfg: ChartConfig, selected: Set<number>, ds: Dataset, renderer: Renderer | undefined): ChartModel {
  const date = isDateField(ds, cfg.field);
  const items: Array<{ fid: number; v: number; cat: string }> = [];
  for (const f of feats) {
    const v = toNumber(f.properties[cfg.field], date);
    if (v === null) continue;
    items.push({ fid: f.id, v, cat: cfg.category ? catKey(f.properties[cfg.category]) : '' });
  }
  if (!items.length) return { kind: 'invalid', message: 'Nothing to chart', detail: `No numeric values in "${cfg.field}".` };
  if (cfg.category && cfg.topN > 0) {
    const w = new Map<string, number>();
    for (const it of items) w.set(it.cat, (w.get(it.cat) ?? 0) + 1);
    const keep = foldOther(w, cfg.topN);
    if (keep) for (const it of items) if (!keep.has(it.cat)) it.cat = OTHER_KEY;
  }
  const groups = [...groupBy(items, (i) => i.cat)].map(([key, g]) => {
    const { stats, outliers } = boxStats(g.map((i) => i.v));
    return { key, label: cfg.category ? catLabel(key) : cfg.field, g, stats, outliers };
  });
  const ordered = sortCats(
    groups.map((g) => ({ ...g, total: g.stats.median })),
    cfg.sort === 'none' ? 'none' : cfg.sort === 'label' ? 'label' : cfg.sort,
  );
  const colors = resolveColors(cfg, renderer, cfg.category, ordered.map((o) => o.key), false);
  const boxes: BoxItem[] = ordered.map((o, i) => ({
    key: o.key, label: o.label, color: colors[i], stats: o.stats,
    outliers: o.outliers.map((idx) => ({ fid: o.g[idx].fid, v: o.g[idx].v, sel: selected.has(o.g[idx].fid) })),
    fids: o.g.map((x) => x.fid), selCount: o.g.filter((x) => selected.has(x.fid)).length,
  }));
  return {
    kind: 'box', boxes, horizontal: cfg.orientation === 'horizontal', valueTitle: cfg.field, catTitle: cfg.category,
    ...base(cfg, feats.length, items.length),
  };
}

/** Build the model for the current config. `feats` must already honour the layer definition query. */
export function buildModel(feats: Feat[], cfg: ChartConfig, ds: Dataset, selected: Set<number>, renderer?: Renderer): ChartModel {
  const miss = missingConfig(cfg);
  if (miss) return { kind: 'invalid', message: 'Chart is not configured', detail: miss };
  if (!feats.length) {
    return cfg.selectionOnly
      ? { kind: 'invalid', message: 'No selected features', detail: 'Select features on the map, in the table or in another chart, or turn off "Selection only".' }
      : { kind: 'invalid', message: 'No features to chart', detail: 'The layer has no features (or its definition query excludes all of them).' };
  }
  switch (cfg.type) {
    case 'bar': return buildBar(feats, cfg, selected, renderer);
    case 'pie': return buildPie(feats, cfg, selected, renderer);
    case 'histogram': return buildHistogram(feats, cfg, selected, ds);
    case 'scatter': return buildScatter(feats, cfg, selected, ds, renderer);
    case 'line': return buildLine(feats, cfg, selected, ds, renderer);
    case 'box': return buildBox(feats, cfg, selected, ds, renderer);
  }
}

// ---------- tabular export ----------

/** The plotted data as a table (first row = header) for "Copy data as CSV". */
export function modelToTable(m: ChartModel, cfg: ChartConfig): string[][] {
  const n = (v: number) => (Number.isFinite(v) ? String(v) : '');
  switch (m.kind) {
    case 'invalid':
      return [];
    case 'bar': {
      if (!m.series.length) return [[m.catTitle, m.valueTitle, 'Features'], ...m.cats.map((c) => [c.label, n(c.total), String(c.count)])];
      return [[m.catTitle, cfg.splitField, m.valueTitle, 'Features'], ...m.cats.flatMap((c) => c.segs.map((s) => [c.label, catLabel(s.series), n(s.value), String(s.count)]))];
    }
    case 'pie':
      return [[cfg.category, m.valueTitle, 'Share', 'Features'], ...m.slices.map((s) => [s.label, n(s.value), n(s.value / m.sum), String(s.count)])];
    case 'histogram':
      return [['Bin start', 'Bin end', 'Count'], ...m.bins.map((b) => [n(m.log ? 10 ** b.x0 : b.x0), n(m.log ? 10 ** b.x1 : b.x1), String(b.count)])];
    case 'scatter':
      return [['FID', m.xTitle, m.yTitle, cfg.colorField, cfg.sizeField].filter((h, i) => i < 3 || h),
        ...m.points.map((p) => {
          const row = [String(p.fid), n(p.x), n(p.y)];
          if (cfg.colorField) row.push(p.g >= 0 ? m.groups[p.g].label : '');
          if (cfg.sizeField) row.push(p.s === null ? '' : n(p.s));
          return row;
        })];
    case 'line':
      return [[m.xTitle, ...m.series.map((s) => s.label)],
        ...[...new Set(m.series.flatMap((s) => s.pts.map((p) => p.x)))].sort((a, b) => a - b).map((x) => [
          m.xIsDate ? new Date(x).toISOString() : n(x),
          ...m.series.map((s) => {
            const p = s.pts.find((q) => q.x === x);
            return p ? n(p.y) : '';
          }),
        ])];
    case 'box':
      return [[cfg.category || 'Group', 'n', 'Min', 'Q1', 'Median', 'Q3', 'Max', 'Lower whisker', 'Upper whisker', 'Outliers'],
        ...m.boxes.map((b) => [b.label, String(b.stats.n), n(b.stats.min), n(b.stats.q1), n(b.stats.median), n(b.stats.q3), n(b.stats.max), n(b.stats.lowerWhisker), n(b.stats.upperWhisker), String(b.outliers.length)])];
  }
}

export function tableToCsv(rows: string[][]): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

/** Short summary text for the toolbar ("1,204 of 1,310 features"). */
export function modelSummary(m: ChartModel): string {
  if (m.kind === 'invalid') return '';
  return m.skipped > 0 ? `${formatValue(m.used)} of ${formatValue(m.total)} features plotted` : `${formatValue(m.used)} features`;
}
