import type { Feature } from '../model';
// Delimited text (CSV / TSV / TXT): parsing, column detection, geometry building.
import Papa from 'papaparse';
import proj4 from 'proj4';
import type { Geometry } from 'geojson';
import { tryParseWkt } from './wkt';
import { reprojectGeometry } from './geojson';

export interface Table {
  headers: string[];
  /** Typed values per row, aligned with headers. */
  rows: any[][];
  delimiter: string;
}

const NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
const LEADING_ZERO = /^[-+]?0\d/;
const BOOL = /^(true|false)$/i;

/** Convert a column of strings to numbers/booleans when every non-empty value agrees. */
function typeColumn(values: string[]): { kind: 'number' | 'boolean' | 'string'; convert: (v: string) => any } {
  let isNum = true;
  let isBool = true;
  let seen = 0;
  for (const raw of values) {
    const v = raw.trim();
    if (v === '') continue;
    seen++;
    if (isNum && (!NUM.test(v) || LEADING_ZERO.test(v))) isNum = false;
    if (isBool && !BOOL.test(v)) isBool = false;
    if (!isNum && !isBool) break;
  }
  if (seen && isNum) return { kind: 'number', convert: (v) => (v.trim() === '' ? null : Number(v)) };
  if (seen && isBool) return { kind: 'boolean', convert: (v) => (v.trim() === '' ? null : v.trim().toLowerCase() === 'true') };
  return { kind: 'string', convert: (v) => (v === '' ? null : v) };
}

function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? '').trim() || `field${i + 1}`;
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    if (n > 0) name = `${name}_${n}`;
    return name;
  });
}

/** Parse delimited text with delimiter auto-detection and column type inference. */
export function parseDelimited(text: string, delimiter?: string): Table {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const res = Papa.parse<string[]>(text, { delimiter: delimiter ?? '', skipEmptyLines: 'greedy', header: false });
  const data = res.data as string[][];
  if (!data.length) throw new Error('The file is empty');
  const headers = uniqueHeaders(data[0]);
  const body = data.slice(1);
  const columns = headers.map((_, c) => typeColumn(body.map((r) => String(r[c] ?? ''))));
  const rows = body.map((r) => headers.map((_, c) => columns[c].convert(String(r[c] ?? ''))));
  return { headers, rows, delimiter: res.meta.delimiter };
}

export interface CsvDetection {
  x: string | null;
  y: string | null;
  wkt: string | null;
  /** Suggested CRS for x/y values. */
  crs: string;
}

const LON_NAMES = ['lon', 'long', 'lng', 'longitude', 'x', 'xcoord', 'x_coord', 'xcoordinate', 'easting', 'lon_dd', 'point_x', 'longitud', 'long_dd', 'x_wgs84'];
const LAT_NAMES = ['lat', 'latitude', 'y', 'ycoord', 'y_coord', 'ycoordinate', 'northing', 'lat_dd', 'point_y', 'latitud', 'y_wgs84'];
const WKT_NAMES = ['wkt', 'geom', 'geometry', 'the_geom', 'shape', 'wkt_geom', 'geometrie'];

const norm = (s: string) => s.toLowerCase().replace(/[\s\-.]+/g, '_');

export function detectCsvColumns(table: Table): CsvDetection {
  const lower = table.headers.map(norm);
  const find = (names: string[]) => {
    for (const n of names) {
      const i = lower.indexOf(n);
      if (i >= 0) return table.headers[i];
    }
    return null;
  };
  let x = find(LON_NAMES);
  let y = find(LAT_NAMES);
  let wkt = find(WKT_NAMES);
  // look at the data for a WKT column under another name
  if (!wkt) {
    for (let c = 0; c < table.headers.length; c++) {
      const sample = table.rows.slice(0, 5).map((r) => r[c]);
      if (sample.some((v) => typeof v === 'string') && sample.filter((v) => typeof v === 'string' && tryParseWkt(v)).length >= Math.min(sample.filter((v) => v != null).length, 3)) {
        wkt = table.headers[c];
        break;
      }
    }
  }
  if (x && y && x === y) y = null;
  if (!x || !y) {
    x = null;
    y = null;
  }
  let crs = 'EPSG:4326';
  if (x && y) {
    const xi = table.headers.indexOf(x);
    const yi = table.headers.indexOf(y);
    let outside = false;
    for (const r of table.rows.slice(0, 200)) {
      const vx = r[xi];
      const vy = r[yi];
      if (typeof vx === 'number' && typeof vy === 'number' && (Math.abs(vx) > 180 || Math.abs(vy) > 90)) {
        outside = true;
        break;
      }
    }
    if (outside) crs = 'EPSG:3857';
  }
  return { x, y, wkt: x && y ? null : wkt, crs };
}

export interface CsvGeometryOptions {
  x?: string | null;
  y?: string | null;
  wkt?: string | null;
  /** CRS of the coordinates (default EPSG:4326). Must be registered with proj4 already. */
  crs?: string;
}

/** Build features (null geometry for rows without a usable location). */
export function tableToFeatures(table: Table, opts: CsvGeometryOptions): { features: Feature[]; located: number } {
  const xi = opts.x ? table.headers.indexOf(opts.x) : -1;
  const yi = opts.y ? table.headers.indexOf(opts.y) : -1;
  const wi = opts.wkt ? table.headers.indexOf(opts.wkt) : -1;
  const crs = opts.crs ?? 'EPSG:4326';
  const conv = crs !== 'EPSG:4326' ? proj4(crs, 'EPSG:4326') : null;
  let located = 0;
  const features: Feature[] = table.rows.map((r) => {
    const properties: Record<string, any> = {};
    table.headers.forEach((h, i) => (properties[h] = r[i]));
    let geometry: Geometry | null = null;
    if (xi >= 0 && yi >= 0) {
      const x = toNumber(r[xi]);
      const y = toNumber(r[yi]);
      if (x !== null && y !== null) {
        if (conv) {
          const [lon, lat] = conv.forward([x, y]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) geometry = { type: 'Point', coordinates: [lon, lat] };
        } else if (Math.abs(x) <= 180 && Math.abs(y) <= 90) geometry = { type: 'Point', coordinates: [x, y] };
      }
    } else if (wi >= 0) {
      geometry = tryParseWkt(r[wi]);
      if (geometry && conv) geometry = reprojectGeometry(geometry, (p) => conv.forward([p[0], p[1]]) as [number, number]);
    }
    if (geometry) located++;
    return { type: 'Feature', geometry, properties };
  });
  return { features, located };
}

function toNumber(v: any): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(',', '.');
    if (NUM.test(s)) return Number(s);
  }
  return null;
}
