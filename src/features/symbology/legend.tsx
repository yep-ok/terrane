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
    case 'proportional':
      return {
        heading: r.field,
        items: [
          { label: String(r.minValue), symbol: { ...r.symbol, size: r.minSize } },
          { label: String(r.maxValue), symbol: { ...r.symbol, size: r.maxSize } },
        ],
      };
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
        <circle cx={width / 2} cy={height / 2} r={Math.max(2, Math.min(symbol.size, height / 2 - 1))} fill={symbol.fill} fillOpacity={symbol.fillOpacity} {...strokeProps} strokeWidth={Math.min(sw, 1.5)} />
      )}
    </svg>
  );
}
