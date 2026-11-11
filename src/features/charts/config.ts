// Chart configuration (stored in ChartDoc.config) and defaults derived from a layer's schema.
import type { ChartDoc, Dataset, Field } from '../../core/types';
import type { Agg } from './stats';
import { suggestBinCount } from './stats';

export type ChartType = 'bar' | 'histogram' | 'scatter' | 'line' | 'pie' | 'box';
export type SortMode = 'value-desc' | 'value-asc' | 'label' | 'none';
export type ColorMode = 'single' | 'ramp' | 'symbology';

export interface ChartConfig {
  type: ChartType;
  // appearance
  /** Custom title; empty = automatic. */
  title: string;
  showTitle: boolean;
  /** Custom title of the horizontal (bottom) axis as displayed; empty = automatic. */
  xTitle: string;
  /** Custom title of the vertical (left) axis as displayed; empty = automatic. */
  yTitle: string;
  legend: boolean;
  grid: boolean;
  colorMode: ColorMode;
  color: string;
  ramp: string;
  /** Chart only the features currently selected on the layer. */
  selectionOnly: boolean;
  // bar / pie / box
  category: string;
  splitField: string;
  splitMode: 'grouped' | 'stacked';
  agg: Agg;
  valueField: string;
  sort: SortMode;
  /** Keep the N largest categories and fold the rest into "Other"; 0 = all. */
  topN: number;
  orientation: 'vertical' | 'horizontal';
  // pie
  donut: boolean;
  sliceLabels: boolean;
  // histogram / box
  field: string;
  bins: number;
  logScale: boolean;
  showMean: boolean;
  showMedian: boolean;
  showStd: boolean;
  // scatter
  xField: string;
  yField: string;
  colorField: string;
  sizeField: string;
  trend: boolean;
  pointSize: number;
  // line
  yFields: string[];
  markers: boolean;
}

export const CHART_TYPES: Array<{ type: ChartType; label: string; noun: string }> = [
  { type: 'bar', label: 'Bar chart', noun: 'Bar' },
  { type: 'histogram', label: 'Histogram', noun: 'Histogram' },
  { type: 'scatter', label: 'Scatter plot', noun: 'Scatter' },
  { type: 'line', label: 'Line chart', noun: 'Line' },
  { type: 'pie', label: 'Pie / donut chart', noun: 'Pie' },
  { type: 'box', label: 'Box plot', noun: 'Box plot' },
];

export const AGG_LABELS: Record<Agg, string> = { count: 'Count', sum: 'Sum', mean: 'Mean', min: 'Minimum', max: 'Maximum' };

export const BASE_CONFIG: Omit<ChartConfig, 'type'> = {
  title: '',
  showTitle: true,
  xTitle: '',
  yTitle: '',
  legend: true,
  grid: true,
  colorMode: 'single',
  color: '#4e79a7',
  ramp: 'Category10',
  selectionOnly: false,
  category: '',
  splitField: '',
  splitMode: 'grouped',
  agg: 'count',
  valueField: '',
  sort: 'value-desc',
  topN: 0,
  orientation: 'vertical',
  donut: false,
  sliceLabels: true,
  field: '',
  bins: 10,
  logScale: false,
  showMean: true,
  showMedian: true,
  showStd: false,
  xField: '',
  yField: '',
  colorField: '',
  sizeField: '',
  trend: true,
  pointSize: 4,
  yFields: [],
  markers: true,
};

const isNumeric = (f: Field) => f.type === 'number' || f.type === 'integer';
const ID_LIKE = /^(fid|oid|objectid|id|gid|ogc_fid|shape_?(length|area|leng))$/i;

/** Distinct value counts over a sample of the dataset. */
function distinctCounts(ds: Dataset, names: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const sample = ds.features.length > 3000 ? ds.features.slice(0, 3000) : ds.features;
  for (const name of names) {
    const set = new Set<any>();
    for (const f of sample) {
      set.add(f.properties[name]);
      if (set.size > 2000) break;
    }
    out.set(name, set.size);
  }
  return out;
}

export interface SchemaPick {
  category: string;
  numeric: string[];
  date: string;
  categoryDistinct: number;
}

/** Choose sensible fields for a schema: the best category field, numeric fields and a date field. */
export function pickFields(ds: Dataset): SchemaPick {
  const numericAll = ds.fields.filter(isNumeric);
  const numeric = numericAll.filter((f) => !ID_LIKE.test(f.name)).map((f) => f.name);
  if (!numeric.length) numeric.push(...numericAll.map((f) => f.name));
  const candidates = ds.fields.filter((f) => f.type === 'string' || f.type === 'boolean');
  const counts = distinctCounts(ds, [...candidates.map((f) => f.name), ...numericAll.filter((f) => f.type === 'integer').map((f) => f.name)]);
  const n = Math.max(1, ds.features.length);
  let category = '';
  let best = Infinity;
  for (const f of candidates) {
    const d = counts.get(f.name) ?? 0;
    if (d < 2) continue;
    // prefer fields that group the data: few distinct values relative to rows, but not trivial
    const score = d > n * 0.6 && n > 10 ? 1e6 + d : Math.abs(Math.log(d) - Math.log(8));
    if (score < best) {
      best = score;
      category = f.name;
    }
  }
  if (!category) {
    const ints = ds.fields.filter((f) => f.type === 'integer' && (counts.get(f.name) ?? 0) >= 2 && (counts.get(f.name) ?? 0) <= 30 && !ID_LIKE.test(f.name));
    category = ints[0]?.name ?? candidates[0]?.name ?? ds.fields[0]?.name ?? '';
  }
  return {
    category,
    numeric,
    date: ds.fields.find((f) => f.type === 'date')?.name ?? '',
    categoryDistinct: counts.get(category) ?? 0,
  };
}

/** Field name if it exists in the dataset (and passes the type check), else ''. */
function valid(ds: Dataset, name: string | undefined, types?: Field['type'][]): string {
  const f = name ? ds.fields.find((x) => x.name === name) : undefined;
  return f && (!types || types.includes(f.type)) ? f.name : '';
}

/**
 * Full config for `type` over `ds`. Fields from `prev` are kept when they still make sense,
 * so switching chart type preserves the user's choices; everything else is derived from the schema.
 */
export function makeConfig(type: ChartType, ds: Dataset | undefined, prev: Partial<ChartConfig> = {}): ChartConfig {
  const cfg: ChartConfig = { ...BASE_CONFIG, ...prev, type };
  if (!ds) return cfg;
  const pick = pickFields(ds);
  const NUM: Field['type'][] = ['number', 'integer'];
  const num = (name: string | undefined, fallbackIdx = 0) => valid(ds, name, NUM) || pick.numeric[fallbackIdx] || '';

  cfg.category = valid(ds, prev.category) || pick.category;
  cfg.splitField = valid(ds, prev.splitField);
  cfg.valueField = valid(ds, prev.valueField, NUM);
  cfg.field = num(prev.field);
  cfg.xField = type === 'line' ? valid(ds, prev.xField, [...NUM, 'date']) || pick.date || num(undefined, 0) : num(prev.xField, 0);
  cfg.yField = valid(ds, prev.yField, NUM) || pick.numeric[pick.numeric.indexOf(cfg.xField) === 0 ? 1 : 0] || pick.numeric[0] || '';
  cfg.colorField = valid(ds, prev.colorField);
  cfg.sizeField = valid(ds, prev.sizeField, NUM);
  const yf = (prev.yFields ?? []).filter((n) => valid(ds, n, NUM));
  cfg.yFields = yf.length ? yf : cfg.yField && cfg.yField !== cfg.xField ? [cfg.yField] : pick.numeric.filter((n) => n !== cfg.xField).slice(0, 1);

  if (cfg.agg !== 'count' && !cfg.valueField) cfg.valueField = pick.numeric[0] ?? '';
  if (!pick.numeric.length) cfg.agg = 'count';
  if (type === 'histogram' && !prev.bins) cfg.bins = suggestBinCount(ds.features.length);
  if (type === 'pie') {
    if (!prev.topN || prev.type !== 'pie') cfg.topN = 8;
    cfg.colorMode = cfg.colorMode === 'single' ? 'ramp' : cfg.colorMode;
  }
  if (type === 'bar' && prev.type === 'pie') cfg.topN = 0;
  if (type === 'bar' && !prev.topN && pick.categoryDistinct > 30) cfg.topN = 20;
  if (type === 'box' && !prev.topN && pick.categoryDistinct > 12) cfg.topN = 12;
  if (prev.type !== type) {
    if (type === 'line') cfg.agg = 'mean';
    else if (prev.type === 'line') cfg.agg = 'count';
  }
  return cfg;
}

/** Merge a stored (possibly partial / older) config over the defaults. */
export function readConfig(chart: ChartDoc): ChartConfig {
  const c = chart.config as Partial<ChartConfig>;
  return { ...BASE_CONFIG, ...c, type: c.type ?? 'bar' };
}

export function autoTitle(cfg: ChartConfig): string {
  const agg = cfg.agg === 'count' || !cfg.valueField ? 'Count' : `${AGG_LABELS[cfg.agg]} of ${cfg.valueField}`;
  switch (cfg.type) {
    case 'bar':
    case 'pie':
      return `${agg} by ${cfg.category || 'category'}`;
    case 'histogram':
      return `Distribution of ${cfg.field || 'values'}${cfg.logScale ? ' (log scale)' : ''}`;
    case 'scatter':
      return `${cfg.yField || 'Y'} vs ${cfg.xField || 'X'}`;
    case 'line':
      return `${cfg.yFields.length ? cfg.yFields.join(', ') : 'Count'} by ${cfg.xField || 'X'}`;
    case 'box':
      return `Box plot of ${cfg.field || 'values'}${cfg.category ? ` by ${cfg.category}` : ''}`;
  }
}

/** Fields a chart of this config reads (for validation messages). */
export function missingConfig(cfg: ChartConfig): string | null {
  switch (cfg.type) {
    case 'bar':
    case 'pie':
      if (!cfg.category) return 'Choose a category field in Chart Properties.';
      if (cfg.agg !== 'count' && !cfg.valueField) return 'Choose a numeric field to aggregate.';
      return null;
    case 'histogram':
    case 'box':
      return cfg.field ? null : 'Choose a numeric field in Chart Properties.';
    case 'scatter':
      return cfg.xField && cfg.yField ? null : 'Choose numeric X and Y fields in Chart Properties.';
    case 'line':
      return cfg.xField ? null : 'Choose an X field in Chart Properties.';
  }
}
