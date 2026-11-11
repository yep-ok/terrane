// KML (and KMZ via the dispatcher) -> layers. Pure string parsing.
import type { Geometry, Position } from 'geojson';
import type { Feature, ParsedLayer } from '../model';
import { descendants, kid, kidText, kids, parseXml, textOf, type XNode } from './xml';

function coords(text: string): Position[] {
  const out: Position[] = [];
  for (const tuple of text.trim().split(/\s+/)) {
    if (!tuple) continue;
    const p = tuple.split(',').map(Number);
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push(p.length > 2 && Number.isFinite(p[2]) ? [p[0], p[1], p[2]] : [p[0], p[1]]);
  }
  return out;
}

function polygon(n: XNode): Geometry | null {
  const outer = kid(n, 'outerBoundaryIs');
  const ring = outer && descendants(outer, 'coordinates')[0];
  if (!ring) return null;
  const rings = [coords(textOf(ring))];
  for (const inner of kids(n, 'innerBoundaryIs')) {
    const c = descendants(inner, 'coordinates')[0];
    if (c) rings.push(coords(textOf(c)));
  }
  return { type: 'Polygon', coordinates: rings.filter((r) => r.length >= 4) };
}

function geometryOf(n: XNode): Geometry | null {
  switch (n.name) {
    case 'Point': {
      const c = coords(kidText(n, 'coordinates'))[0];
      return c ? { type: 'Point', coordinates: c } : null;
    }
    case 'LineString':
    case 'LinearRing': {
      const c = coords(kidText(n, 'coordinates'));
      return c.length >= 2 ? { type: 'LineString', coordinates: c } : null;
    }
    case 'Polygon':
      return polygon(n);
    case 'Track': {
      const c = kids(n, 'coord')
        .map((k) => textOf(k).split(/\s+/).map(Number))
        .filter((p) => p.length >= 2 && p.every(Number.isFinite)) as Position[];
      return c.length >= 2 ? { type: 'LineString', coordinates: c } : null;
    }
    case 'MultiGeometry':
    case 'MultiTrack': {
      const parts = n.children.map(geometryOf).filter((g): g is Geometry => !!g);
      if (!parts.length) return null;
      if (parts.every((g) => g.type === 'Point')) return { type: 'MultiPoint', coordinates: parts.map((g) => (g as any).coordinates) };
      if (parts.every((g) => g.type === 'LineString')) return { type: 'MultiLineString', coordinates: parts.map((g) => (g as any).coordinates) };
      if (parts.every((g) => g.type === 'Polygon')) return { type: 'MultiPolygon', coordinates: parts.map((g) => (g as any).coordinates) };
      return { type: 'GeometryCollection', geometries: parts };
    }
    default:
      return null;
  }
}

const GEOM_NAMES = new Set(['Point', 'LineString', 'LinearRing', 'Polygon', 'MultiGeometry', 'Track', 'MultiTrack']);

function placemark(pm: XNode): Feature {
  const properties: Record<string, any> = {};
  const name = kidText(pm, 'name');
  if (name) properties.name = name;
  const desc = kidText(pm, 'description');
  if (desc) properties.description = desc;
  const ext = kid(pm, 'ExtendedData');
  if (ext) {
    for (const d of descendants(ext, 'Data')) {
      const k = d.attrs.name;
      if (k) properties[k] = kidText(d, 'value');
    }
    for (const d of descendants(ext, 'SimpleData')) {
      const k = d.attrs.name;
      if (k) properties[k] = textOf(d);
    }
  }
  const g = pm.children.find((c) => GEOM_NAMES.has(c.name));
  return { type: 'Feature', geometry: g ? geometryOf(g) : null, properties };
}

/** Values that look like numbers (all rows) are converted so inference gives numeric fields. */
function typeProps(features: Feature[]) {
  const keys = new Set<string>();
  features.forEach((f) => Object.keys(f.properties ?? {}).forEach((k) => keys.add(k)));
  for (const k of keys) {
    if (k === 'name' || k === 'description') continue;
    const vals = features.map((f) => f.properties?.[k]).filter((v) => v !== undefined && v !== '');
    if (vals.length && vals.every((v) => typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v) && !/^[-+]?0\d/.test(v)))
      for (const f of features) if (f.properties && typeof f.properties[k] === 'string' && f.properties[k] !== '') f.properties[k] = Number(f.properties[k]);
  }
}

export function parseKml(text: string, fileName: string): ParsedLayer[] {
  const root = parseXml(text);
  if (root.name !== 'kml' && root.name !== 'Document' && root.name !== 'Folder' && root.name !== 'Placemark') throw new Error('The file is not a KML document');
  const features = (root.name === 'Placemark' ? [root] : descendants(root, 'Placemark')).map(placemark);
  if (!features.length) throw new Error('The KML file contains no placemarks');
  typeProps(features);
  const docName = root.name === 'Placemark' ? '' : kidText(descendants(root, 'Document')[0] ?? root, 'name');
  return [{ name: fileName || docName || 'KML', features }];
}
