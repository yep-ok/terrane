import type { Feature } from './model';
// Web service helpers: WMS / WFS capabilities, ArcGIS REST feature paging. Network code only; the XML
// parsing functions are pure.

import { descendants, kid, kidText, kids, parseXml, type XNode } from './parse/xml';
import { normalizeGeoJSON } from './parse/geojson';
import { networkMessage } from './importer';

export interface ServiceLayer {
  /** Identifier to request (WMS layer name, WFS type name, ArcGIS layer id). */
  name: string;
  title: string;
  depth: number;
  /** False for grouping entries that cannot be requested. */
  selectable: boolean;
}

/** Set query parameters (case-insensitive replace) on a URL. */
export function withParams(url: string, params: Record<string, string>): string {
  const u = new URL(url);
  for (const key of Object.keys(params)) for (const existing of [...u.searchParams.keys()]) if (existing.toLowerCase() === key.toLowerCase()) u.searchParams.delete(existing);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** Base URL without the OGC request parameters (what OL's WMS source expects). */
export function stripOgcParams(url: string): string {
  const u = new URL(url);
  for (const k of [...u.searchParams.keys()]) if (/^(service|request|version|layers|layer|styles|format|transparent|crs|srs|bbox|width|height|typename|typenames|outputformat)$/i.test(k)) u.searchParams.delete(k);
  return u.toString().replace(/\?$/, '');
}

async function getText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(networkMessage(url, e));
  }
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} ${res.statusText}`.trim());
  return res.text();
}

function serviceException(root: XNode): string | null {
  if (root.name === 'ServiceExceptionReport' || root.name === 'ExceptionReport') {
    const t = descendants(root, 'ServiceException')[0] ?? descendants(root, 'ExceptionText')[0];
    return (t?.text ?? 'The service reported an error').trim();
  }
  return null;
}

// ---------- WMS ----------

export interface WmsCapabilities {
  version: string;
  title: string;
  layers: ServiceLayer[];
  formats: string[];
}

export function parseWmsCapabilities(xml: string): WmsCapabilities {
  const root = parseXml(xml);
  const err = serviceException(root);
  if (err) throw new Error(err);
  if (!/Capabilities$/.test(root.name)) throw new Error('The response is not a WMS capabilities document');
  const cap = kid(root, 'Capability');
  if (!cap) throw new Error('The capabilities document has no Capability section');
  const layers: ServiceLayer[] = [];
  const walk = (n: XNode, depth: number) => {
    const name = kidText(n, 'Name');
    const title = kidText(n, 'Title') || name;
    layers.push({ name, title, depth, selectable: !!name });
    for (const c of kids(n, 'Layer')) walk(c, depth + 1);
  };
  for (const l of kids(cap, 'Layer')) walk(l, 0);
  const getMap = kid(kid(cap, 'Request') ?? cap, 'GetMap');
  const formats = getMap ? kids(getMap, 'Format').map((f) => f.text.trim()) : [];
  return { version: root.attrs.version ?? '1.3.0', title: kidText(kid(root, 'Service') ?? root, 'Title'), layers, formats };
}

export async function fetchWmsCapabilities(url: string): Promise<WmsCapabilities> {
  return parseWmsCapabilities(await getText(withParams(url, { service: 'WMS', request: 'GetCapabilities' })));
}

// ---------- WFS ----------

export function parseWfsFeatureTypes(xml: string): ServiceLayer[] {
  const root = parseXml(xml);
  const err = serviceException(root);
  if (err) throw new Error(err);
  if (!/Capabilities$/.test(root.name)) throw new Error('The response is not a WFS capabilities document');
  return descendants(root, 'FeatureType')
    .map((ft) => ({ name: kidText(ft, 'Name'), title: kidText(ft, 'Title') || kidText(ft, 'Name'), depth: 0, selectable: true }))
    .filter((l) => l.name);
}

export async function fetchWfsFeatureTypes(url: string): Promise<ServiceLayer[]> {
  return parseWfsFeatureTypes(await getText(withParams(url, { service: 'WFS', request: 'GetCapabilities' })));
}

export async function fetchWfsFeatures(url: string, typeName: string, maxFeatures = 10000): Promise<Feature[]> {
  const q = withParams(url, {
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: typeName, outputFormat: 'application/json', srsName: 'EPSG:4326', count: String(maxFeatures),
  });
  const text = await getText(q);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The server did not return GeoJSON for this layer. It may not offer application/json output.');
  }
  const features = normalizeGeoJSON(json);
  if (!features.length) throw new Error('The layer returned no features');
  return features;
}

// ---------- ArcGIS REST ----------

export const ARCGIS_LAYER_RE = /\/(FeatureServer|MapServer)\/(\d+)\/?(\?.*)?$/i;
export const ARCGIS_SERVICE_RE = /\/(FeatureServer|MapServer)\/?(\?.*)?$/i;

async function arcgisJson(url: string): Promise<any> {
  const text = await getText(url);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The URL did not return an ArcGIS REST response');
  }
  if (json?.error) throw new Error(json.error.message ?? 'ArcGIS service error');
  return json;
}

const cleanUrl = (u: string) => u.split('?')[0].replace(/\/+$/, '');

export async function fetchArcgisServiceLayers(url: string): Promise<ServiceLayer[]> {
  const info = await arcgisJson(`${cleanUrl(url)}?f=json`);
  const out: ServiceLayer[] = [];
  for (const l of [...(info.layers ?? []), ...(info.tables ?? [])]) out.push({ name: String(l.id), title: l.name ?? `Layer ${l.id}`, depth: 0, selectable: true });
  if (!out.length) throw new Error('The service lists no layers');
  return out;
}

export interface ArcgisResult {
  name: string;
  features: Feature[];
  truncated: boolean;
}

export async function fetchArcgisFeatures(layerUrl: string, onProgress?: (n: number) => void, maxFeatures = 100000): Promise<ArcgisResult> {
  const base = cleanUrl(layerUrl);
  const info = await arcgisJson(`${base}?f=json`);
  const pageSize = Math.max(100, Math.min(Number(info.maxRecordCount) || 1000, 2000));
  const oid = (info.fields ?? []).find((f: any) => f.type === 'esriFieldTypeOID')?.name as string | undefined;
  const dateFields: string[] = (info.fields ?? []).filter((f: any) => f.type === 'esriFieldTypeDate').map((f: any) => f.name);
  const features: Feature[] = [];
  let offset = 0;
  let firstOfPrev: string | null = null;
  let truncated = false;
  for (;;) {
    const q =
      `${base}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson&resultOffset=${offset}&resultRecordCount=${pageSize}` +
      (oid ? `&orderByFields=${encodeURIComponent(oid)}` : '');
    const json = await arcgisJson(q);
    const page = normalizeGeoJSON(json);
    if (!page.length) break;
    const sig = JSON.stringify(page[0].properties) + JSON.stringify(page[0].geometry).slice(0, 80);
    if (offset > 0 && sig === firstOfPrev) break; // server ignores paging; avoid duplicating the first page forever
    firstOfPrev = sig;
    for (const f of page) {
      if (oid && f.properties && f.properties.id !== undefined && f.properties.id === f.properties[oid]) delete f.properties.id;
      for (const d of dateFields) {
        const v = f.properties?.[d];
        if (typeof v === 'number') f.properties![d] = new Date(v).toISOString();
      }
      features.push(f);
    }
    onProgress?.(features.length);
    const exceeded = json.exceededTransferLimit ?? json.properties?.exceededTransferLimit;
    if (exceeded === false || (exceeded === undefined && page.length < pageSize)) break;
    offset += page.length;
    if (features.length >= maxFeatures) {
      truncated = true;
      break;
    }
  }
  if (!features.length) throw new Error('The layer returned no features');
  return { name: info.name ?? 'ArcGIS layer', features, truncated };
}
