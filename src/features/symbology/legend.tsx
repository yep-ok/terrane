// Legend model + swatch — PUBLIC CONTRACT used by Contents and Layouts.
// (Basic implementation; the symbology module may refine bodies but must keep these exports.)
import type { Dataset, FeatureLayer, GeomType, SymbolDef } from '../../core/types';
import { rampColors } from './ramps';

export interface LegendItem {
  label: string;
  symbol: SymbolDef;
}
export interface LayerLegend {
  /** Heading shown above the items (e.g. the classification field); undefined for single symbol. */
  heading?: string;
  items: LegendItem[];
  /** For heat maps: colour ramp stops to draw as a gradient instead of items. */
  gradient?: string[];
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2 }) : '');

export function legendFor(layer: FeatureLayer, _ds?: Dataset): LayerLegend {
  const r = layer.renderer;
  switch (r.type) {
    case 'single':
      return { items: [{ label: r.label ?? '', symbol: r.symbol }] };
    case 'unique': {
      const items = r.classes.filter((c) => c.visible !== false).map((c) => ({ label: c.label, symbol: c.symbol }));
      if (r.defaultSymbol) items.push({ label: '<all other values>', symbol: r.defaultSymbol });
      return { heading: r.field, items };
    }
    case 'graduated':
      return { heading: r.normalization ? `${r.field} / ${r.normalization}` : r.field, items: r.classes.map((c) => ({ label: c.label, symbol: c.symbol })) };
    case 'proportional': {
      const line = _ds?.geomType === 'LineString';
      const sized = (size: number): SymbolDef => (line ? { ...r.symbol, strokeWidth: size } : { ...r.symbol, size });
      return {
        heading: r.field,
        items: [
          { label: fmt(r.minValue), symbol: sized(r.minSize) },
          { label: fmt(r.maxValue), symbol: sized(r.maxSize) },
        ],
      };
    }
    case 'heatmap':
      return { heading: r.field, items: [], gradient: rampColors(r.ramp, 6) };
  }
}

/** SVG patch for a symbol on a geometry family. */
export function SymbolSwatch({ symbol, geomType, width = 22, height = 14 }: { symbol: SymbolDef; geomType: GeomType | null; width?: number; height?: number }) {
  const sw = Math.min(symbol.strokeWidth, 3);
  const strokeProps = { stroke: symbol.stroke, strokeWidth: sw, strokeOpacity: symbol.strokeOpacity ?? 1, strokeDasharray: symbol.strokeDash?.join(' ') };
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ flex: 'none', display: 'block' }}>
      {geomType === 'Polygon' ? (
        <rect x={1.5} y={1.5} width={width - 3} height={height - 3} fill={symbol.fill} fillOpacity={symbol.fillOpacity} {...strokeProps} />
      ) : geomType === 'LineString' ? (
        <path d={`M1 ${height - 3} L${width * 0.35} 3 L${width * 0.65} ${height - 3} L${width - 1} 3`} fill="none" {...strokeProps} strokeWidth={Math.max(1, sw)} />
      ) : (
        <MarkerGlyph symbol={symbol} cx={width / 2} cy={height / 2} r={Math.max(2.5, Math.min(symbol.size, height / 2 - 1.5))} strokeProps={{ ...strokeProps, strokeWidth: Math.min(sw, 1.5) }} />
      )}
    </svg>
  );
}

const poly = (cx: number, cy: number, r: number, n: number, rot: number, r2?: number) => {
  const pts: string[] = [];
  const total = r2 !== undefined ? n * 2 : n;
  for (let i = 0; i < total; i++) {
    const rad = r2 !== undefined && i % 2 === 1 ? r2 : r;
    const a = rot - Math.PI / 2 + (i * 2 * Math.PI) / total;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
};

/** A marker shape drawn in SVG, centred at (cx, cy) with radius r. */
export function MarkerGlyph({ symbol, cx, cy, r, strokeProps }: { symbol: SymbolDef; cx: number; cy: number; r: number; strokeProps?: Record<string, any> }) {
  const sp = strokeProps ?? { stroke: symbol.stroke, strokeWidth: Math.min(symbol.strokeWidth, 1.5), strokeOpacity: symbol.strokeOpacity ?? 1 };
  const fill = { fill: symbol.fill, fillOpacity: symbol.fillOpacity };
  switch (symbol.shape) {
    case 'square': {
      const h = r * 0.9;
      return <rect x={cx - h} y={cy - h} width={h * 2} height={h * 2} {...fill} {...sp} />;
    }
    case 'triangle':
      return <polygon points={poly(cx, cy, r * 1.05, 3, 0)} {...fill} {...sp} />;
    case 'diamond':
      return <polygon points={poly(cx, cy, r * 1.1, 4, 0)} {...fill} {...sp} />;
    case 'star':
      return <polygon points={poly(cx, cy, r * 1.15, 5, 0, r * 0.5)} {...fill} {...sp} />;
    case 'cross':
    case 'x': {
      const d = r * 1.05;
      const rot = symbol.shape === 'x' ? Math.PI / 4 : 0;
      const p = (a: number) => [cx + d * Math.sin(a + rot), cy - d * Math.cos(a + rot)];
      const [x1, y1] = p(0), [x2, y2] = p(Math.PI), [x3, y3] = p(Math.PI / 2), [x4, y4] = p(-Math.PI / 2);
      return <path d={`M${x1} ${y1}L${x2} ${y2}M${x3} ${y3}L${x4} ${y4}`} stroke={symbol.fill} strokeOpacity={Math.max(symbol.fillOpacity, 0.1)} strokeWidth={2} strokeLinecap="butt" fill="none" />;
    }
    default:
      return <circle cx={cx} cy={cy} r={r} {...fill} {...sp} />;
  }
}

/** Horizontal colour-ramp strip, used for heat map legends. */
export function GradientBar({ colors, width = 120, height = 10 }: { colors: string[]; width?: number; height?: number }) {
  return <div style={{ width, height, borderRadius: 2, background: `linear-gradient(to right, ${colors.join(', ')})`, border: '1px solid var(--border)' }} />;
}
