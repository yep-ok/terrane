// Symbology -> OpenLayers styles — PUBLIC CONTRACT. The implementation here only
// handles single-symbol circles; the symbology module replaces the bodies
// (all renderers, marker shapes, labels) while keeping these exports.
import { Circle, Fill, Stroke, Style } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';
import type { Dataset, FeatureLayer, GeomType, SymbolDef } from '../core/types';

export type FeatStyleFn = (feature: FeatureLike, resolution: number) => Style | Style[] | undefined;

export const SELECTION_COLOR = '#00e5ff';

export function rgba(hex: string, opacity = 1): string {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  const n = parseInt(v.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}

/** OL style for one symbol drawn on a geometry family. */
export function symbolToStyle(sym: SymbolDef, geomType: GeomType | null): Style {
  const stroke = new Stroke({ color: rgba(sym.stroke, sym.strokeOpacity ?? 1), width: sym.strokeWidth, lineDash: sym.strokeDash });
  const fill = new Fill({ color: rgba(sym.fill, sym.fillOpacity) });
  if (geomType === 'Point' || geomType === null)
    return new Style({ image: new Circle({ radius: sym.size, fill, stroke: sym.strokeWidth > 0 ? stroke : undefined, declutterMode: 'none' }) });
  if (geomType === 'LineString') return new Style({ stroke });
  return new Style({ fill, stroke: sym.strokeWidth > 0 ? stroke : undefined });
}

/** Style function for a feature layer: renderer + labels. OL features expose the Feat via feature.get('feat'). */
export function makeStyleFunction(layer: FeatureLayer, ds: Dataset): FeatStyleFn {
  const r = layer.renderer;
  const sym = r.type === 'single' ? r.symbol : r.type === 'graduated' ? r.base : r.type === 'proportional' ? r.symbol : r.type === 'unique' ? r.defaultSymbol ?? r.classes[0]?.symbol : null;
  const style = sym ? symbolToStyle(sym, ds.geomType) : new Style({});
  return () => style;
}

/** Extra styles drawn on top of a selected feature. */
export function selectionStyles(geomType: GeomType | null, markerSize = 6): Style[] {
  const stroke = new Stroke({ color: SELECTION_COLOR, width: 2.5 });
  if (geomType === 'Point' || geomType === null)
    return [new Style({ zIndex: 1000, image: new Circle({ radius: markerSize + 3, stroke, fill: new Fill({ color: rgba(SELECTION_COLOR, 0.25) }), declutterMode: 'none' }) })];
  if (geomType === 'LineString') return [new Style({ zIndex: 1000, stroke: new Stroke({ color: SELECTION_COLOR, width: 3.5 }) })];
  return [new Style({ zIndex: 1000, stroke, fill: new Fill({ color: rgba(SELECTION_COLOR, 0.12) }) })];
}
