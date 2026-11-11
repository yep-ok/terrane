// GeoJSON normalisation and reprojection (pure; no store access).
import proj4 from 'proj4';
import type { Geometry, Position } from 'geojson';
import { ensureCrs } from '../../../core/crs';
import type { Feature, ParsedLayer } from '../model';

const GEOM_TYPES = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection']);

/** Nested objects/arrays cannot live in a table cell; stringify them. */
export function flattenProps(props: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!props || typeof props !== 'object') return out;
  for (const k in props) {
    const v = props[k];
    out[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  return out;
}

function toFeature(x: any): Feature | null {
  if (!x || typeof x !== 'object') return null;
  if (x.type === 'Feature') {
    const props = flattenProps(x.properties);
    if (x.id !== undefined && x.id !== null && !('id' in props) && (typeof x.id === 'string' || typeof x.id === 'number')) props.id = x.id;
    return { type: 'Feature', geometry: x.geometry && GEOM_TYPES.has(x.geometry.type) ? x.geometry : null, properties: props };
  }
  if (GEOM_TYPES.has(x.type)) return { type: 'Feature', geometry: x, properties: {} };
  return null;
}

/** Accept FeatureCollection, Feature, bare geometry, or an array of any of these. */
export function normalizeGeoJSON(input: any): Feature[] {
  if (Array.isArray(input)) return input.flatMap((x) => normalizeGeoJSON(x));
  if (!input || typeof input !== 'object') return [];
  if (input.type === 'FeatureCollection') return (input.features ?? []).map(toFeature).filter((f: Feature | null): f is Feature => !!f);
  const f = toFeature(input);
  return f ? [f] : [];
}

/** Read the legacy GeoJSON `crs` member and return an EPSG code, or null when absent / WGS84. */
export function legacyCrsCode(input: any): string | null {
  const name: unknown = input?.crs?.properties?.name;
  if (typeof name !== 'string') return null;
  if (/CRS84|OGC:1\.3:CRS84/i.test(name)) return null;
  const m = /EPSG:{1,2}(\d+)/i.exec(name);
  if (!m) return null;
  const code = `EPSG:${m[1]}`;
  return code === 'EPSG:4326' ? null : code;
}

function mapCoords(c: any, fn: (p: Position) => Position): any {
  return typeof c[0] === 'number' ? fn(c) : c.map((x: any) => mapCoords(x, fn));
}

export function reprojectGeometry(g: Geometry | null, fn: (p: Position) => Position): Geometry | null {
  if (!g) return g;
  if (g.type === 'GeometryCollection') return { type: 'GeometryCollection', geometries: g.geometries.map((x) => reprojectGeometry(x, fn)!) };
  return { ...g, coordinates: mapCoords(g.coordinates, fn) } as Geometry;
}

/** Reproject features from a (registered) CRS to EPSG:4326. */
export function reprojectFeatures(features: Feature[], fromCode: string): Feature[] {
  const t = proj4(fromCode, 'EPSG:4326');
  const fn = (p: Position): Position => {
    const [x, y] = t.forward([p[0], p[1]]);
    return p.length > 2 ? [x, y, p[2]] : [x, y];
  };
  return features.map((f) => ({ ...f, geometry: reprojectGeometry(f.geometry, fn) }));
}

/** Turn an already-parsed GeoJSON value into one layer, honouring a legacy crs member. */
export async function parseGeoJSON(json: any, name: string): Promise<ParsedLayer[]> {
  let features = normalizeGeoJSON(json);
  if (!features.length) throw new Error('No GeoJSON features were found in the file');
  const warnings: string[] = [];
  const code = legacyCrsCode(json);
  if (code) {
    if (!(await ensureCrs(code))) throw new Error(`The data declares coordinate system ${code}, which could not be loaded`);
    features = reprojectFeatures(features, code);
    warnings.push(`Reprojected from ${code} to WGS 1984`);
  }
  return [{ name, features, warnings }];
}
