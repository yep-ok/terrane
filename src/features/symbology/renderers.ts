// Builders for each renderer type, used when the user switches type or changes classification settings.
import type { ClassMethod, Dataset, FeatureLayer, GeomType, RangeClass, Renderer, SymbolDef, UniqueClass } from '../../core/types';
import { defaultSymbol } from '../../core/store';
import { collectNumbers, computeBreaks, MAX_UNIQUE_CLASSES, rangeClasses, uniqueLabel, uniqueValues } from './classify';
import { rampColors } from './ramps';

export type RendererType = Renderer['type'];

export const RENDERER_LABELS: Record<RendererType, string> = {
  single: 'Single Symbol',
  unique: 'Unique Values',
  graduated: 'Graduated Colors',
  proportional: 'Graduated Symbols',
  heatmap: 'Heat Map',
};

export const METHOD_LABELS: Record<ClassMethod, string> = {
  equal: 'Equal Interval',
  quantile: 'Quantile',
  jenks: 'Natural Breaks',
  stddev: 'Standard Deviation',
  manual: 'Manual',
};

export function validRendererTypes(geom: GeomType | null): RendererType[] {
  if (geom === 'Point') return ['single', 'unique', 'graduated', 'proportional', 'heatmap'];
  if (geom === 'LineString' || geom === 'Polygon') return ['single', 'unique', 'graduated', 'proportional'];
  return [];
}

/** The colour that represents a symbol in a swatch / histogram for its geometry family. */
export function symbolColor(sym: SymbolDef, geom: GeomType | null): string {
  return geom === 'LineString' ? sym.stroke : sym.fill;
}

/** Copy of a symbol with its main colour replaced (fill for points/polygons, stroke for lines). */
export function recolor(sym: SymbolDef, geom: GeomType | null, color: string): SymbolDef {
  if (geom === 'LineString') return { ...sym, stroke: color, fill: color };
  return { ...sym, fill: color };
}

/** The symbol currently representing the layer, whatever its renderer. */
export function baseSymbolOf(layer: FeatureLayer, ds: Dataset): SymbolDef {
  const r = layer.renderer;
  const s =
    r.type === 'single' ? r.symbol
    : r.type === 'graduated' ? r.base
    : r.type === 'proportional' ? r.symbol
    : r.type === 'unique' ? r.defaultSymbol ?? r.classes[0]?.symbol
    : undefined;
  return s ?? defaultSymbol(ds.geomType);
}

export function numericFields(ds: Dataset) {
  return ds.fields.filter((f) => f.type === 'number' || f.type === 'integer');
}

/** Best guess of an interesting categorical field (low cardinality string, else first field). */
export function defaultCategoryField(ds: Dataset): string | undefined {
  const sample = ds.features.length > 3000 ? ds.features.slice(0, 3000) : ds.features;
  const card = (name: string) => new Set(sample.map((f) => f.properties[name])).size;
  const candidates = ds.fields.filter((f) => f.type === 'string' || f.type === 'boolean' || f.type === 'integer');
  const good = candidates.filter((f) => {
    const c = card(f.name);
    return c > 1 && c <= Math.max(12, sample.length / 3) && c <= MAX_UNIQUE_CLASSES;
  });
  const pick = good.find((f) => f.type === 'string') ?? good[0] ?? candidates[0] ?? ds.fields[0];
  return pick?.name;
}

export function defaultNumericField(ds: Dataset): string | undefined {
  const nums = numericFields(ds);
  return (nums.find((f) => !/(^|_)(id|fid|objectid|code|zip)$/i.test(f.name)) ?? nums[0])?.name;
}

export function buildUnique(ds: Dataset, field: string, ramp: string, base: SymbolDef): Renderer {
  const geom = ds.geomType;
  const { values, total } = uniqueValues(ds.features, field);
  const colors = rampColors(ramp, Math.max(1, values.length));
  const classes: UniqueClass[] = values.map((v, i) => ({
    value: v.value,
    label: uniqueLabel(v.value),
    symbol: recolor(base, geom, colors[i]),
  }));
  return { type: 'unique', field, classes, ramp, defaultSymbol: total > values.length ? recolor(base, geom, '#9aa0a6') : null };
}

export function buildGraduated(
  ds: Dataset, field: string, normalization: string | undefined, method: ClassMethod, count: number, ramp: string, base: SymbolDef,
  reverse = false, values?: number[],
): Renderer {
  const nums = values ?? collectNumbers(ds.features, field, normalization);
  const breaks = computeBreaks(nums, method === 'manual' ? 'equal' : method, count);
  const colors = rampColors(ramp, breaks.uppers.length);
  if (reverse) colors.reverse();
  const symbols = colors.map((c) => recolor(base, ds.geomType, c));
  return { type: 'graduated', field, normalization: normalization || undefined, method, classes: rangeClasses(breaks, symbols), ramp, base };
}

/** Re-colour existing classes along a ramp (e.g. after the ramp changed or was reversed). */
export function recolorClasses(classes: RangeClass[], geom: GeomType | null, ramp: string, reverse = false): RangeClass[] {
  const colors = rampColors(ramp, classes.length);
  if (reverse) colors.reverse();
  return classes.map((c, i) => ({ ...c, symbol: recolor(c.symbol, geom, colors[i]) }));
}

export function dataRange(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min === Infinity ? { min: 0, max: 1 } : { min, max };
}

export function buildProportional(ds: Dataset, field: string, base: SymbolDef, sizes?: { minSize: number; maxSize: number }): Renderer {
  const { min, max } = dataRange(collectNumbers(ds.features, field));
  const line = ds.geomType === 'LineString';
  return {
    type: 'proportional',
    field,
    minValue: min,
    maxValue: max,
    minSize: sizes?.minSize ?? (line ? 1 : 3),
    maxSize: sizes?.maxSize ?? (line ? 10 : 18),
    symbol: ds.geomType === 'Polygon' ? { ...base, fillOpacity: Math.max(base.fillOpacity, 0.8) } : base,
  };
}

export function buildHeatmap(field?: string): Renderer {
  return { type: 'heatmap', field, radius: 14, blur: 16, ramp: 'Heat' };
}

/** A sensible renderer of the requested type for this layer, or null when no suitable field exists. */
export function defaultRenderer(type: RendererType, layer: FeatureLayer, ds: Dataset): Renderer | null {
  const base = baseSymbolOf(layer, ds);
  const r = layer.renderer;
  switch (type) {
    case 'single':
      return { type: 'single', symbol: base };
    case 'unique': {
      const field = defaultCategoryField(ds);
      return field ? buildUnique(ds, field, 'Category10', base) : null;
    }
    case 'graduated': {
      const field = defaultNumericField(ds);
      if (!field) return null;
      const prev = r.type === 'graduated' ? r : null;
      return buildGraduated(ds, field, undefined, prev?.method ?? 'jenks', prev?.classes.length ?? 5, prev?.ramp ?? 'Yellow-Orange-Red', base);
    }
    case 'proportional': {
      const field = defaultNumericField(ds);
      return field ? buildProportional(ds, field, base) : null;
    }
    case 'heatmap':
      return buildHeatmap(defaultNumericField(ds) && r.type === 'proportional' ? r.field : undefined);
  }
}
