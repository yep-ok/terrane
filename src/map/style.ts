// Symbology -> OpenLayers styles — PUBLIC CONTRACT (exports kept stable).
// Style objects are built once per class / size bucket; the only per-feature work is
// a table lookup and (when labelled) one setText() on a shared Text instance.
import { Circle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import type ImageStyle from 'ol/style/Image';
import type { FeatureLike } from 'ol/Feature';
import type Feature from 'ol/Feature';
import type Geometry from 'ol/geom/Geometry';
import type Polygon from 'ol/geom/Polygon';
import type MultiPolygon from 'ol/geom/MultiPolygon';
import type { Dataset, Feat, FeatureLayer, GeomType, LabelDef, SymbolDef } from '../core/types';
import { compileExpr, type Compiled } from '../core/expr';
import { classIndex, numericValue, uniqueKey } from '../features/symbology/classify';

export type FeatStyleFn = (feature: FeatureLike, resolution: number) => Style | Style[] | undefined;

export const SELECTION_COLOR = '#00e5ff';

export function rgba(hex: string, opacity = 1): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(v.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

// ---------- symbols ----------

const dashOf = (sym: SymbolDef) => (sym.strokeDash && sym.strokeDash.length ? sym.strokeDash : undefined);

function strokeOf(sym: SymbolDef, width = sym.strokeWidth): Stroke {
  const dash = dashOf(sym);
  return new Stroke({ color: rgba(sym.stroke, sym.strokeOpacity ?? 1), width, lineDash: dash, lineCap: dash ? 'butt' : 'round', lineJoin: 'round' });
}

/** Marker image for a point symbol; `size` overrides the radius. */
export function markerImage(sym: SymbolDef, size = sym.size, fillOpacity = sym.fillOpacity): ImageStyle {
  const fill = new Fill({ color: rgba(sym.fill, fillOpacity) });
  const hasStroke = sym.strokeWidth > 0;
  const stroke = hasStroke ? strokeOf(sym) : undefined;
  const common = { declutterMode: 'none' as const };
  const r = Math.max(0.5, size);
  switch (sym.shape) {
    case 'square':
      return new RegularShape({ ...common, points: 4, radius: r * 1.25, angle: Math.PI / 4, fill, stroke });
    case 'triangle':
      return new RegularShape({ ...common, points: 3, radius: r * 1.3, angle: 0, fill, stroke });
    case 'diamond':
      return new RegularShape({ ...common, points: 4, radius: r * 1.4, angle: 0, fill, stroke });
    case 'star':
      return new RegularShape({ ...common, points: 5, radius: r * 1.5, radius2: r * 0.6, angle: 0, fill, stroke });
    case 'cross':
    case 'x': {
      // Line glyphs: drawn with a stroke in the symbol's fill colour.
      const glyph = new Stroke({ color: rgba(sym.fill, Math.max(sym.fillOpacity, 0.05)), width: Math.max(2, sym.strokeWidth), lineCap: 'butt' });
      return new RegularShape({ ...common, points: 4, radius: r * 1.3, radius2: 0, angle: sym.shape === 'x' ? Math.PI / 4 : 0, stroke: glyph });
    }
    default:
      return new Circle({ ...common, radius: r, fill, stroke });
  }
}

/** OL style for one symbol drawn on a geometry family. */
export function symbolToStyle(sym: SymbolDef, geomType: GeomType | null): Style {
  if (geomType === 'Point' || geomType === null) return new Style({ image: markerImage(sym) });
  if (geomType === 'LineString') return new Style({ stroke: strokeOf(sym) });
  return new Style({ fill: new Fill({ color: rgba(sym.fill, sym.fillOpacity) }), stroke: sym.strokeWidth > 0 ? strokeOf(sym) : undefined });
}

// ---------- labels ----------

const ZOOM0_RES = 156543.034;
const zoomToRes = (z: number) => ZOOM0_RES / 2 ** z;

interface LabelEngine {
  text: Text;
  /** Updates the shared Text for this feature (empty string hides it). */
  apply(feature: FeatureLike, resolution: number): void;
}

function makeLabelEngine(labels: LabelDef | undefined, geomType: GeomType | null, markerSize: number): LabelEngine | null {
  if (!labels?.enabled || !labels.expression?.trim()) return null;
  let fn: Compiled;
  try {
    fn = compileExpr(labels.expression);
  } catch {
    return null;
  }
  const family = labels.fontFamily || "'Segoe UI', system-ui, sans-serif";
  const font = `${labels.italic ? 'italic ' : ''}${labels.bold ? 'bold ' : ''}${Math.max(6, labels.fontSize || 12)}px ${family}`;
  const isPoint = geomType === 'Point' || geomType === null;
  const isLine = geomType === 'LineString';
  const followLine = isLine && !!labels.followLine;
  const text = new Text({
    font,
    fill: new Fill({ color: labels.color || '#1b1b1b' }),
    stroke: labels.haloWidth > 0 ? new Stroke({ color: labels.haloColor || '#ffffff', width: labels.haloWidth * 2, lineJoin: 'round' }) : undefined,
    textAlign: isPoint ? 'left' : 'center',
    textBaseline: 'middle',
    offsetX: (labels.offsetX ?? 0) + (isPoint ? markerSize + 4 : 0),
    offsetY: labels.offsetY ?? 0,
    placement: followLine ? 'line' : 'point',
    overflow: geomType === 'Polygon' || followLine,
    maxAngle: Math.PI / 4,
    padding: [1, 2, 1, 2],
    declutterMode: labels.allowOverlap ? 'none' : 'declutter',
  });
  const maxRes = labels.minZoom !== undefined ? zoomToRes(labels.minZoom) * 1.0001 : Infinity;
  const minRes = labels.maxZoom !== undefined ? zoomToRes(labels.maxZoom + 1) : 0; // visible through the whole max zoom level
  return {
    text,
    apply(feature, resolution) {
      if (resolution > maxRes || resolution < minRes) {
        text.setText('');
        return;
      }
      const feat = feature.get('feat') as Feat | undefined;
      let s = '';
      if (feat) {
        try {
          const v = fn(feat);
          s = v === null || v === undefined ? '' : String(v);
        } catch {
          s = '';
        }
      }
      text.setText(s);
    },
  };
}

// ---------- style function ----------

const EMPTY = new Style({});

const interiorCache = new WeakMap<object, Geometry>();
function interiorPoint(f: FeatureLike): Geometry | undefined {
  const g = (f as Feature).getGeometry?.();
  if (!g) return undefined;
  let p = interiorCache.get(g);
  if (!p) {
    const t = g.getType();
    p = t === 'Polygon' ? (g as Polygon).getInteriorPoint() : t === 'MultiPolygon' ? (g as MultiPolygon).getInteriorPoints() : undefined;
    if (p) interiorCache.set(g, p);
  }
  return p;
}

const labelPointCache = new WeakMap<object, Geometry>();
/** Label anchor for a polygon feature: an interior point of its largest part. */
function labelPoint(f: FeatureLike): Geometry | undefined {
  const g = (f as Feature).getGeometry?.();
  if (!g) return undefined;
  let p = labelPointCache.get(g);
  if (!p) {
    const t = g.getType();
    if (t === 'Polygon') p = (g as Polygon).getInteriorPoint();
    else if (t === 'MultiPolygon') {
      let best: Polygon | undefined;
      let bestArea = -1;
      for (const poly of (g as MultiPolygon).getPolygons()) {
        const a = poly.getArea();
        if (a > bestArea) {
          bestArea = a;
          best = poly;
        }
      }
      p = best?.getInteriorPoint();
    }
    if (p) labelPointCache.set(g, p);
  }
  return p;
}

/** Style for one symbol, with the shared label Text attached when labelling is on. */
function classStyle(sym: SymbolDef, geom: GeomType | null, text: Text | undefined): Style {
  const s = symbolToStyle(sym, geom);
  if (text) s.setText(text);
  return s;
}

function symbolForRenderer(layer: FeatureLayer): SymbolDef | null {
  const r = layer.renderer;
  switch (r.type) {
    case 'single': return r.symbol;
    case 'unique': return r.defaultSymbol ?? r.classes[0]?.symbol ?? null;
    case 'graduated': return r.base;
    case 'proportional': return r.symbol;
    default: return null;
  }
}

/** Style function for a feature layer: renderer + labels. OL features expose the Feat via feature.get('feat'). */
export function makeStyleFunction(layer: FeatureLayer, ds: Dataset): FeatStyleFn {
  const r = layer.renderer;
  const geom = ds.geomType;
  if (r.type === 'heatmap') return () => EMPTY;

  const markerSize = r.type === 'proportional' ? r.maxSize : symbolForRenderer(layer)?.size ?? 5;
  const label = makeLabelEngine(layer.labels, geom, markerSize);
  // Polygons get their label from a separate style anchored inside the largest part,
  // so a multipart feature (an archipelago, say) is labelled once rather than per part.
  const polyLabel = label && geom === 'Polygon' ? new Style({ text: label.text, geometry: labelPoint }) : null;
  const text = polyLabel ? undefined : label?.text;
  const withLabel = new WeakMap<object, Style[]>();
  const wrap = (fn: (f: FeatureLike, res: number) => Style | Style[] | undefined): FeatStyleFn =>
    label
      ? (f, res) => {
          const s = fn(f, res);
          if (!s) return s;
          label.apply(f, res);
          if (!polyLabel) return s;
          let out = withLabel.get(s);
          if (!out) {
            out = Array.isArray(s) ? [...s, polyLabel] : [s, polyLabel];
            withLabel.set(s, out);
          }
          return out;
        }
      : fn;

  switch (r.type) {
    case 'single': {
      const style = classStyle(r.symbol, geom, text);
      return wrap(() => style);
    }

    case 'unique': {
      const map = new Map<string, Style | null>();
      for (const c of r.classes) if (!map.has(c.value)) map.set(c.value, c.visible === false ? null : classStyle(c.symbol, geom, text));
      const fallback = r.defaultSymbol ? classStyle(r.defaultSymbol, geom, text) : null;
      const field = r.field;
      return wrap((f) => {
        const feat = f.get('feat') as Feat | undefined;
        const hit = map.get(uniqueKey(feat?.properties?.[field]));
        if (hit !== undefined) return hit ?? undefined;
        return fallback ?? undefined;
      });
    }

    case 'graduated': {
      const classes = r.classes;
      if (!classes.length) return () => undefined;
      const styles = classes.map((c) => classStyle(c.symbol, geom, text));
      const uppers = classes.map((c) => c.max);
      const lo = classes[0].min;
      const hi = uppers[uppers.length - 1];
      const { field, normalization } = r;
      return wrap((f) => {
        const feat = f.get('feat') as Feat | undefined;
        const v = numericValue(feat?.properties, field, normalization);
        if (v === null || v < lo || v > hi) return undefined;
        let a = 0;
        let b = uppers.length - 1;
        while (a < b) {
          const m = (a + b) >> 1;
          if (v <= uppers[m]) b = m;
          else a = m + 1;
        }
        return styles[a];
      });
    }

    case 'proportional': {
      const { field, minValue, maxValue, minSize, maxSize, symbol } = r;
      const span = maxValue - minValue;
      const sizeFor = (v: number) => {
        const t = span > 0 ? Math.min(1, Math.max(0, (v - minValue) / span)) : 1;
        return minSize + Math.sqrt(t) * (maxSize - minSize);
      };
      const cache = new Map<number, Style | Style[]>();
      const base = geom === 'Polygon'
        ? new Style({ fill: new Fill({ color: rgba(symbol.fill, symbol.fillOpacity * 0.35) }), stroke: symbol.strokeWidth > 0 ? strokeOf(symbol) : undefined, text })
        : null;
      const build = (q: number): Style | Style[] => {
        if (geom === 'LineString') {
          const s = new Style({ stroke: strokeOf(symbol, Math.max(0.5, q)) });
          if (text) s.setText(text);
          return s;
        }
        if (geom === 'Polygon') {
          return [base!, new Style({ geometry: interiorPoint, image: markerImage(symbol, q, Math.max(symbol.fillOpacity, 0.7)) })];
        }
        const s = new Style({ image: markerImage(symbol, q) });
        if (text) s.setText(text);
        return s;
      };
      return wrap((f) => {
        const feat = f.get('feat') as Feat | undefined;
        const v = numericValue(feat?.properties, field);
        if (v === null) return geom === 'Polygon' ? base ?? undefined : undefined;
        const q = Math.round(sizeFor(v) * 4) / 4; // quarter-pixel buckets keep the cache small
        let s = cache.get(q);
        if (!s) {
          s = build(q);
          cache.set(q, s);
        }
        return s;
      });
    }
  }
}

/** Extra styles drawn on top of a selected feature. */
export function selectionStyles(geomType: GeomType | null, markerSize = 6): Style[] {
  const stroke = new Stroke({ color: SELECTION_COLOR, width: 2.5 });
  if (geomType === 'Point' || geomType === null)
    return [new Style({ zIndex: 1000, image: new Circle({ radius: markerSize + 3, stroke, fill: new Fill({ color: rgba(SELECTION_COLOR, 0.25) }), declutterMode: 'none' }) })];
  if (geomType === 'LineString') return [new Style({ zIndex: 1000, stroke: new Stroke({ color: SELECTION_COLOR, width: 3.5 }) })];
  return [new Style({ zIndex: 1000, stroke, fill: new Fill({ color: rgba(SELECTION_COLOR, 0.12) }) })];
}
