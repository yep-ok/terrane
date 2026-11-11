// File dispatcher: bytes -> parsed layers / rasters / tables / projects. No store access.
import JSZip from 'jszip';
import * as shpNs from 'shpjs';

import { ensureCrs } from '../../../core/crs';
import { type Feature, baseName, extOf, type ParsedLayer, type ParsedRaster } from '../model';
import { normalizeGeoJSON, parseGeoJSON, reprojectFeatures } from './geojson';
import { parseTopology } from './topo';
import { detectCsvColumns, parseDelimited, type CsvDetection, type Table } from './csv';
import { parseKml } from './kml';
import { parseGpx } from './gpx';
import { tiffLonLatExtent } from './tiff';

const shp: any = (shpNs as any).default ?? shpNs;
const shpParseShp: (b: ArrayBuffer, prj?: string) => any = (shpNs as any).parseShp ?? shp.parseShp;
const shpParseDbf: (b: ArrayBuffer, cpg?: ArrayBuffer) => any = (shpNs as any).parseDbf ?? shp.parseDbf;
const shpCombine: (a: [any[], any[] | undefined]) => any = (shpNs as any).combine ?? shp.combine;

export type Parsed =
  | { kind: 'layers'; layers: ParsedLayer[] }
  | { kind: 'raster'; raster: ParsedRaster }
  | { kind: 'csv'; name: string; table: Table; detection: CsvDetection }
  | { kind: 'project'; json: any; name: string };

export interface FormatInfo {
  label: string;
  extensions: string[];
  note: string;
}
export const SUPPORTED_FORMATS: FormatInfo[] = [
  { label: 'GeoJSON', extensions: ['geojson', 'json'], note: 'Features, geometries, legacy crs member' },
  { label: 'TopoJSON', extensions: ['topojson', 'json'], note: 'Every object becomes a layer' },
  { label: 'Shapefile', extensions: ['zip', 'shp', 'dbf', 'prj', 'cpg'], note: 'Zipped, or select .shp with .dbf and .prj' },
  { label: 'KML / KMZ', extensions: ['kml', 'kmz'], note: 'Placemarks with extended data' },
  { label: 'GPX', extensions: ['gpx'], note: 'Waypoints, routes and tracks' },
  { label: 'Delimited text', extensions: ['csv', 'tsv', 'txt'], note: 'X/Y columns or WKT; or a standalone table' },
  { label: 'FlatGeobuf', extensions: ['fgb'], note: 'Binary vector format' },
  { label: 'GeoTIFF', extensions: ['tif', 'tiff'], note: 'Raster layer' },
  { label: 'Terrane project', extensions: ['terrane'], note: 'Replaces the open project' },
];
export const ACCEPT = '.geojson,.json,.topojson,.zip,.shp,.dbf,.prj,.cpg,.kml,.kmz,.gpx,.csv,.tsv,.txt,.fgb,.tif,.tiff,.terrane';

/** Decode bytes as UTF-8, falling back to Windows-1252 for legacy exports. */
export function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const layers = (l: ParsedLayer[]): Parsed => ({ kind: 'layers', layers: l });

function shpResultToLayers(res: any, fallback: string): ParsedLayer[] {
  const arr: any[] = Array.isArray(res) ? res : [res];
  const out: ParsedLayer[] = [];
  for (const fc of arr) {
    const features = normalizeGeoJSON(fc);
    if (features.length) out.push({ name: arr.length === 1 ? fallback : fc.fileName || fallback, features });
  }
  if (!out.length) throw new Error('The shapefile contains no features');
  return out;
}

async function parseJsonText(text: string, name: string): Promise<Parsed[]> {
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON');
  }
  if (json?.format === 'terrane-project') return [{ kind: 'project', json, name }];
  if (json?.type === 'Topology') return [layers(parseTopology(json, name))];
  return [layers(await parseGeoJSON(json, name))];
}

async function parseFgb(buf: ArrayBuffer, name: string): Promise<Parsed[]> {
  const { deserialize } = await import('flatgeobuf/geojson');
  let crs = null as number | null;
  const raw: Feature[] = [];
  const gen = deserialize(new Uint8Array(buf), { headerMetaFn: (h) => void (crs = h.crs?.code ?? null) });
  for await (const f of gen) raw.push(f as unknown as Feature);
  if (!raw.length) throw new Error('The FlatGeobuf file contains no features');
  let out = normalizeGeoJSON(raw);
  if (crs && crs !== 4326) {
    const code = `EPSG:${crs}`;
    if (await ensureCrs(code)) out = reprojectFeatures(out, code);
  }
  return [layers([{ name, features: out }])];
}

async function parseZipFile(buf: ArrayBuffer, name: string): Promise<Parsed[]> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !n.includes('__MACOSX') && !n.split('/').pop()!.startsWith('._'));
  if (names.some((n) => extOf(n) === 'shp')) {
    const res = await shp.parseZip(buf);
    return [layers(shpResultToLayers(res, name))];
  }
  const out: Parsed[] = [];
  for (const n of names) {
    const e = extOf(n);
    if (['geojson', 'json', 'topojson', 'kml', 'gpx', 'csv', 'tsv', 'fgb'].includes(e)) {
      const inner = await zip.files[n].async('arraybuffer');
      out.push(...(await parseBuffer(n, inner)));
    }
  }
  if (!out.length) throw new Error('The archive does not contain a supported dataset (shapefile, GeoJSON, KML, GPX or CSV)');
  return out;
}

async function parseKmz(buf: ArrayBuffer, name: string): Promise<Parsed[]> {
  const zip = await JSZip.loadAsync(buf);
  const kmls = Object.keys(zip.files).filter((n) => extOf(n) === 'kml' && !zip.files[n].dir);
  if (!kmls.length) throw new Error('The KMZ archive contains no KML file');
  const main = kmls.find((n) => /(^|\/)doc\.kml$/i.test(n)) ?? kmls[0];
  return [layers(parseKml(await zip.files[main].async('string'), name))];
}

/** Parse one file's bytes. Shapefile parts other than .zip are handled by parseShapefileParts. */
export async function parseBuffer(fileName: string, buf: ArrayBuffer): Promise<Parsed[]> {
  const ext = extOf(fileName);
  const name = baseName(fileName);
  switch (ext) {
    case 'geojson':
    case 'json':
    case 'topojson':
    case 'terrane':
      return parseJsonText(decodeText(buf), name);
    case 'zip':
      return parseZipFile(buf, name);
    case 'kmz':
      return parseKmz(buf, name);
    case 'kml':
      return [layers(parseKml(decodeText(buf), name))];
    case 'gpx':
      return [layers(parseGpx(decodeText(buf), name))];
    case 'fgb':
      return parseFgb(buf, name);
    case 'tif':
    case 'tiff': {
      const blob = new Blob([buf], { type: 'image/tiff' });
      return [{ kind: 'raster', raster: { name, blob, extent: (await tiffLonLatExtent(blob).catch(() => null)) ?? undefined } }];
    }
    case 'csv':
    case 'tsv':
    case 'txt':
      return [csvParsed(decodeText(buf), name, ext === 'tsv' ? '\t' : undefined)];
    case 'shp':
      throw new Error('Select the .shp together with its .dbf and .prj files, or add a zipped shapefile');
    case 'dbf':
    case 'prj':
    case 'cpg':
      return [];
    default:
      return sniff(buf, name);
  }
}

function csvParsed(text: string, name: string, delimiter?: string): Parsed {
  const table = parseDelimited(text, delimiter);
  return { kind: 'csv', name, table, detection: detectCsvColumns(table) };
}

async function sniff(buf: ArrayBuffer, name: string): Promise<Parsed[]> {
  const head = new Uint8Array(buf.slice(0, 4));
  if (head[0] === 0x50 && head[1] === 0x4b) return parseZipFile(buf, name);
  if (head[0] === 0x66 && head[1] === 0x67 && head[2] === 0x62) return parseFgb(buf, name);
  const text = decodeText(buf);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return parseJsonText(text, name);
  if (t.startsWith('<')) {
    if (/<gpx[\s>]/i.test(t.slice(0, 600))) return [layers(parseGpx(text, name))];
    return [layers(parseKml(text, name))];
  }
  if (/[,;\t]/.test(t.split(/\r?\n/, 1)[0] ?? '')) return [csvParsed(text, name)];
  throw new Error(`Unrecognised file type ".${extOf(name) || '?'}"`);
}

/** Parse the loose parts of shapefiles (.shp/.dbf/.prj/.cpg) selected together. */
export async function parseShapefileParts(files: Array<{ name: string; buffer: ArrayBuffer }>): Promise<Parsed[]> {
  const groups = new Map<string, Partial<Record<'shp' | 'dbf' | 'prj' | 'cpg', ArrayBuffer>>>();
  for (const f of files) {
    const key = baseName(f.name).toLowerCase();
    const g = groups.get(key) ?? {};
    g[extOf(f.name) as 'shp'] = f.buffer;
    groups.set(key, g);
  }
  const out: Parsed[] = [];
  for (const [key, g] of groups) {
    const display = baseName(files.find((f) => baseName(f.name).toLowerCase() === key)!.name);
    if (g.shp) {
      const prj = g.prj ? decodeText(g.prj) : undefined;
      const geoms = shpParseShp(g.shp, prj);
      const props = g.dbf ? shpParseDbf(g.dbf, g.cpg) : undefined;
      const fc = shpCombine([geoms, props]);
      out.push(layers(shpResultToLayers(fc, display)));
    } else if (g.dbf) {
      const props: any[] = shpParseDbf(g.dbf, g.cpg);
      out.push(layers([{ name: display, features: props.map((p) => ({ type: 'Feature', geometry: null, properties: p ?? {} })) }]));
    }
  }
  return out;
}

export const isShapefilePart = (name: string) => ['shp', 'dbf', 'prj', 'cpg', 'shx'].includes(extOf(name));
