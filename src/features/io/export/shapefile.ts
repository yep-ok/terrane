// Shapefile writer (SHP + SHX + DBF + PRJ + CPG in a zip). Written from the ESRI spec so
// that mixed Polygon/MultiPolygon data, null geometries and typed DBF columns are handled correctly.
import JSZip from 'jszip';
import type { Geometry, Position } from 'geojson';
import type { Field } from '../../../core/types';

export interface ShpFeature {
  geometry: Geometry | null;
  properties: Record<string, any>;
}

const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** DBF field names: max 10 chars, [A-Za-z0-9_], unique (case-insensitive). */
export function shapefileFieldNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    let base = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'FIELD';
    if (/^\d/.test(base)) base = `F${base}`.slice(0, 10);
    let name = base;
    for (let i = 1; used.has(name.toLowerCase()); i++) {
      const suffix = `_${i}`;
      name = base.slice(0, 10 - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

type Shape = { kind: 'point'; p: Position } | { kind: 'multipoint'; pts: Position[] } | { kind: 'poly'; parts: Position[][] } | { kind: 'null' };
type ShapeType = 1 | 3 | 5 | 8;

const signedArea = (r: Position[]) => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return a / 2; // >0 for clockwise in a y-up system with this formula
};
const closed = (r: Position[]) => {
  const f = r[0];
  const l = r[r.length - 1];
  return f[0] === l[0] && f[1] === l[1] ? r : [...r, f];
};
/** Shapefile convention: outer rings clockwise, holes counter-clockwise. */
function orient(ring: Position[], clockwise: boolean): Position[] {
  const r = closed(ring);
  const cw = signedArea(r) > 0;
  return cw === clockwise ? r : [...r].reverse();
}

function toShape(g: Geometry | null, type: ShapeType): Shape {
  if (!g) return { kind: 'null' };
  if (type === 1) return g.type === 'Point' ? { kind: 'point', p: g.coordinates } : { kind: 'null' };
  if (type === 8) {
    if (g.type === 'Point') return { kind: 'multipoint', pts: [g.coordinates] };
    return g.type === 'MultiPoint' ? { kind: 'multipoint', pts: g.coordinates } : { kind: 'null' };
  }
  if (type === 3) {
    if (g.type === 'LineString') return { kind: 'poly', parts: [g.coordinates] };
    return g.type === 'MultiLineString' ? { kind: 'poly', parts: g.coordinates } : { kind: 'null' };
  }
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return { kind: 'null' };
  const parts: Position[][] = [];
  for (const poly of polys) poly.forEach((ring, i) => ring.length >= 3 && parts.push(orient(ring, i === 0)));
  return parts.length ? { kind: 'poly', parts } : { kind: 'null' };
}

function pickType(features: ShpFeature[]): ShapeType | null {
  let multiPoint = false;
  let fam: 'p' | 'l' | 'a' | null = null;
  for (const f of features) {
    const g = f.geometry;
    if (!g) continue;
    const t = g.type;
    const k = t === 'Point' || t === 'MultiPoint' ? 'p' : t === 'LineString' || t === 'MultiLineString' ? 'l' : t === 'Polygon' || t === 'MultiPolygon' ? 'a' : null;
    if (!k) continue;
    if (t === 'MultiPoint') multiPoint = true;
    fam ??= k;
  }
  if (!fam) return null;
  return fam === 'p' ? (multiPoint ? 8 : 1) : fam === 'l' ? 3 : 5;
}

function contentLength(s: Shape, type: ShapeType): number {
  if (s.kind === 'null') return 4;
  if (s.kind === 'point') return 20;
  if (s.kind === 'multipoint') return 4 + 32 + 4 + 16 * s.pts.length;
  return 4 + 32 + 8 + 4 * s.parts.length + 16 * s.parts.reduce((n, p) => n + p.length, 0);
}

function bounds(points: Iterable<Position>) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x0, y0, x1, y1 };
}

function shapePoints(s: Shape): Position[] {
  if (s.kind === 'point') return [s.p];
  if (s.kind === 'multipoint') return s.pts;
  if (s.kind === 'poly') return s.parts.flat();
  return [];
}

export function buildShpShx(features: ShpFeature[], type: ShapeType): { shp: Uint8Array; shx: Uint8Array } {
  const shapes = features.map((f) => toShape(f.geometry, type));
  const lengths = shapes.map((s) => contentLength(s, type));
  const shpBytes = 100 + lengths.reduce((n, l) => n + l + 8, 0);
  const shxBytes = 100 + 8 * shapes.length;
  const shp = new DataView(new ArrayBuffer(shpBytes));
  const shx = new DataView(new ArrayBuffer(shxBytes));
  const all = bounds(shapes.flatMap(shapePoints));
  const bb = all.x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : all;
  for (const [v, bytes] of [[shp, shpBytes], [shx, shxBytes]] as const) {
    v.setInt32(0, 9994);
    v.setInt32(24, bytes / 2);
    v.setInt32(28, 1000, true);
    v.setInt32(32, type, true);
    v.setFloat64(36, bb.x0, true);
    v.setFloat64(44, bb.y0, true);
    v.setFloat64(52, bb.x1, true);
    v.setFloat64(60, bb.y1, true);
  }
  let o = 100;
  shapes.forEach((s, i) => {
    const len = lengths[i];
    shx.setInt32(100 + i * 8, o / 2);
    shx.setInt32(104 + i * 8, len / 2);
    shp.setInt32(o, i + 1);
    shp.setInt32(o + 4, len / 2);
    let p = o + 8;
    if (s.kind === 'null') {
      shp.setInt32(p, 0, true);
    } else if (s.kind === 'point') {
      shp.setInt32(p, 1, true);
      shp.setFloat64(p + 4, s.p[0], true);
      shp.setFloat64(p + 12, s.p[1], true);
    } else {
      shp.setInt32(p, type, true);
      const b = bounds(shapePoints(s));
      shp.setFloat64(p + 4, b.x0, true);
      shp.setFloat64(p + 12, b.y0, true);
      shp.setFloat64(p + 20, b.x1, true);
      shp.setFloat64(p + 28, b.y1, true);
      p += 36;
      if (s.kind === 'multipoint') {
        shp.setInt32(p, s.pts.length, true);
        p += 4;
        for (const pt of s.pts) {
          shp.setFloat64(p, pt[0], true);
          shp.setFloat64(p + 8, pt[1], true);
          p += 16;
        }
      } else {
        const total = s.parts.reduce((n, q) => n + q.length, 0);
        shp.setInt32(p, s.parts.length, true);
        shp.setInt32(p + 4, total, true);
        p += 8;
        let idx = 0;
        for (const part of s.parts) {
          shp.setInt32(p, idx, true);
          p += 4;
          idx += part.length;
        }
        for (const part of s.parts)
          for (const pt of part) {
            shp.setFloat64(p, pt[0], true);
            shp.setFloat64(p + 8, pt[1], true);
            p += 16;
          }
      }
    }
    o += len + 8;
  });
  return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
}

// ---------- DBF ----------

interface DbfCol {
  name: string;
  type: 'C' | 'N' | 'L';
  size: number;
  dec: number;
}

const enc = new TextEncoder();

function truncateUtf8(s: string, max: number): Uint8Array {
  let b = enc.encode(s);
  if (b.length <= max) return b;
  const chars = Array.from(s);
  while (chars.length && (b = enc.encode(chars.join(''))).length > max) chars.pop();
  return b;
}

function decimalsOf(v: number): number {
  const s = String(v);
  if (/e/i.test(s)) return 15;
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

function fmtNumber(v: number, dec: number, size: number): string {
  let s = v.toFixed(dec);
  if (s.length > size) s = v.toFixed(Math.max(0, dec - (s.length - size)));
  return s.length > size ? s.slice(0, size) : s;
}

function describeColumns(fields: Field[], names: string[], features: ShpFeature[]): DbfCol[] {
  return fields.map((f, i) => {
    const vals = features.map((ft) => ft.properties[f.name]).filter((v) => v !== null && v !== undefined && v !== '');
    if (f.type === 'boolean') return { name: names[i], type: 'L', size: 1, dec: 0 };
    if (f.type === 'integer' || f.type === 'number') {
      let intDigits = 1;
      let dec = 0;
      let neg = 0;
      for (const v of vals) {
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        intDigits = Math.max(intDigits, String(Math.trunc(Math.abs(n))).length);
        if (n < 0) neg = 1;
        if (f.type === 'number') dec = Math.max(dec, Math.min(15, decimalsOf(n)));
      }
      let size = intDigits + neg + (dec ? dec + 1 : 0);
      if (size > 24) {
        dec = Math.max(0, dec - (size - 24));
        size = intDigits + neg + (dec ? dec + 1 : 0);
      }
      return { name: names[i], type: 'N', size: Math.max(1, Math.min(size, 24)), dec };
    }
    let max = 1;
    for (const v of vals) max = Math.max(max, enc.encode(typeof v === 'object' ? JSON.stringify(v) : String(v)).length);
    return { name: names[i], type: 'C', size: Math.min(254, max), dec: 0 };
  });
}

export function buildDbf(fields: Field[], names: string[], features: ShpFeature[]): Uint8Array {
  const cols = describeColumns(fields, names, features);
  const headerLen = 32 + 32 * cols.length + 1;
  const recLen = 1 + cols.reduce((n, c) => n + c.size, 0);
  const out = new Uint8Array(headerLen + recLen * features.length + 1);
  const v = new DataView(out.buffer);
  const now = new Date();
  v.setUint8(0, 0x03);
  v.setUint8(1, now.getFullYear() - 1900);
  v.setUint8(2, now.getMonth() + 1);
  v.setUint8(3, now.getDate());
  v.setUint32(4, features.length, true);
  v.setUint16(8, headerLen, true);
  v.setUint16(10, recLen, true);
  cols.forEach((c, i) => {
    const o = 32 + i * 32;
    out.set(enc.encode(c.name).slice(0, 10), o);
    out[o + 11] = c.type.charCodeAt(0);
    out[o + 16] = c.size;
    out[o + 17] = c.dec;
  });
  out[headerLen - 1] = 0x0d;
  let o = headerLen;
  for (const ft of features) {
    out[o++] = 0x20;
    cols.forEach((c, i) => {
      const val = ft.properties[fields[i].name];
      const empty = val === null || val === undefined || val === '';
      let bytes: Uint8Array;
      if (c.type === 'L') bytes = enc.encode(empty ? '?' : val === true || /^(true|t|1|yes|y)$/i.test(String(val)) ? 'T' : 'F');
      else if (c.type === 'N') {
        const n = Number(val);
        const s = empty || !Number.isFinite(n) ? '' : fmtNumber(n, c.dec, c.size);
        bytes = enc.encode(s.padStart(c.size, ' '));
      } else bytes = truncateUtf8(empty ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val), c.size);
      // numbers are right-aligned, text left-aligned and space padded
      out.fill(0x20, o, o + c.size);
      out.set(bytes.slice(0, c.size), o);
      o += c.size;
    });
  }
  out[o] = 0x1a;
  return out;
}

export interface ShapefileResult {
  zip: Uint8Array;
  /** Original -> DBF field name pairs that had to change. */
  renamed: Array<[string, string]>;
  count: number;
}

export async function buildShapefileZip(baseName: string, fields: Field[], features: ShpFeature[]): Promise<ShapefileResult> {
  const type = pickType(features);
  if (!type) throw new Error('A shapefile needs point, line or polygon geometry. Export tables as CSV instead.');
  const names = shapefileFieldNames(fields.map((f) => f.name));
  const { shp, shx } = buildShpShx(features, type);
  const dbf = buildDbf(fields, names, features);
  const zip = new JSZip();
  zip.file(`${baseName}.shp`, shp);
  zip.file(`${baseName}.shx`, shx);
  zip.file(`${baseName}.dbf`, dbf);
  zip.file(`${baseName}.prj`, WGS84_PRJ);
  zip.file(`${baseName}.cpg`, 'UTF-8');
  return {
    zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    renamed: fields.map((f, i) => [f.name, names[i]] as [string, string]).filter(([a, b]) => a !== b),
    count: features.length,
  };
}
