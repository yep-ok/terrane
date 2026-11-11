// TopoJSON -> GeoJSON layers (one per topology object).
import { feature } from 'topojson-client';

import { flattenProps, normalizeGeoJSON } from './geojson';
import type { Feature, ParsedLayer } from '../model';

export function parseTopology(topo: any, fileName: string): ParsedLayer[] {
  const objects: Record<string, any> = topo?.objects ?? {};
  const keys = Object.keys(objects);
  if (!keys.length) throw new Error('The TopoJSON file has no objects');
  const layers: ParsedLayer[] = [];
  for (const key of keys) {
    const gj: any = feature(topo, objects[key]);
    const features: Feature[] = normalizeGeoJSON(gj).map((f) => ({ ...f, properties: flattenProps(f.properties) }));
    if (features.length) layers.push({ name: keys.length === 1 ? fileName : `${fileName} - ${key}`, features });
  }
  if (!layers.length) throw new Error('The TopoJSON file contains no features');
  return layers;
}
