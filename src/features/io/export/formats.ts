// Feature exporters. Pure functions: a source (fields + features) in, text/Blob out.
import type { Geometry, Position } from 'geojson';
import type { Field, GeomType } from '../../../core/types';
import { escapeXml } from '../parse/xml';
import { toWkt } from '../parse/wkt';
import { buildShapefileZip } from './shapefile';

export interface ExportFeature {
  geometry: Geometry | null;
  properties: Record<string, any>;
}
export interface ExportSource {
  name: string;
  geomType: GeomType | null;
  fields: Field[];
  features: ExportFeature[];
}

export type ExportFormat = 'geojson' | 'shapefile' | 'kml' | 'gpx' | 'csv';
export const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; ext: string; mime: string }> = [
  { id: 'geojson', label: 'GeoJSON (.geojson)', ext: 'geojson', mime: 'application/geo+json' },
  { id: 'shapefile', label: 'Shapefile, zipped (.zip)', ext: 'zip', mime: 'application/zip' },
  { id: 'kml', label: 'KML (.kml)', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml' },
  { id: 'gpx', label: 'GPX (.gpx)', ext: 'gpx', mime: 'application/gpx+xml' },
  { id: 'csv', label: 'CSV (.csv)', ext: 'csv', mime: 'text/csv' },
];

export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'export';
}

// ---------- GeoJSON ----------

export function toGeoJSON(src: ExportSource): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    name: src.name,
    features: src.features.map((f) => ({ type: 'Feature', properties: f.properties, geometry: f.geometry })),
  });
}

// ---------- CSV ----------

export type CsvGeometry = 'xy' | 'wkt' | 'none';

function csvCell(v: any, delimiter: string): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function bboxCentre(g: Geometry | null): Position | null {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const walk = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    } else for (const x of c) walk(x);
  };
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => walk((x as any).coordinates));
  else walk(g.coordinates);
  return x0 === Infinity ? null : [(x0 + x1) / 2, (y0 + y1) / 2];
}

export function toCsv(src: ExportSource, opts: { geometry?: CsvGeometry; delimiter?: string } = {}): string {
  const delimiter = opts.delimiter ?? ',';
  const mode = opts.geometry ?? 'xy';
  const names = src.fields.map((f) => f.name);
  const taken = new Set(names.map((n) => n.toLowerCase()));
  const unique = (n: string) => {
    while (taken.has(n.toLowerCase())) n += '_';
    taken.add(n.toLowerCase());
    return n;
  };
  const header = [...names];
  const xName = mode === 'xy' ? unique('X') : '';
  const yName = mode === 'xy' ? unique('Y') : '';
  const wName = mode === 'wkt' ? unique('WKT') : '';
  if (mode === 'xy') header.push(xName, yName);
  if (mode === 'wkt') header.push(wName);
  const lines = [header.map((h) => csvCell(h, delimiter)).join(delimiter)];
  for (const f of src.features) {
    const row = names.map((n) => csvCell(f.properties[n], delimiter));
    if (mode === 'xy') {
      const c = bboxCentre(f.geometry);
      row.push(c ? String(c[0]) : '', c ? String(c[1]) : '');
    } else if (mode === 'wkt') row.push(csvCell(toWkt(f.geometry), delimiter));
    lines.push(row.join(delimiter));
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------- KML ----------

const nameField = (fields: Field[]) => fields.find((f) => /^(name|title|label)$/i.test(f.name))?.name;
const coordStr = (p: Position) => p.slice(0, 3).join(',');
const ringStr = (c: Position[]) => c.map(coordStr).join(' ');

function kmlGeometry(g: Geometry): string {
  switch (g.type) {
    case 'Point':
      return `<Point><coordinates>${coordStr(g.coordinates)}</coordinates></Point>`;
    case 'LineString':
      return `<LineString><coordinates>${ringStr(g.coordinates)}</coordinates></LineString>`;
    case 'Polygon':
      return kmlPolygon(g.coordinates);
    case 'MultiPoint':
      return `<MultiGeometry>${g.coordinates.map((c) => kmlGeometry({ type: 'Point', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiLineString':
      return `<MultiGeometry>${g.coordinates.map((c) => kmlGeometry({ type: 'LineString', coordinates: c })).join('')}</MultiGeometry>`;
    case 'MultiPolygon':
      return `<MultiGeometry>${g.coordinates.map(kmlPolygon).join('')}</MultiGeometry>`;
    case 'GeometryCollection':
      return `<MultiGeometry>${g.geometries.map(kmlGeometry).join('')}</MultiGeometry>`;
  }
}
function kmlPolygon(rings: Position[][]): string {
  const [outer, ...inner] = rings;
  return (
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ringStr(outer)}</coordinates></LinearRing></outerBoundaryIs>` +
    inner.map((r) => `<innerBoundaryIs><LinearRing><coordinates>${ringStr(r)}</coordinates></LinearRing></innerBoundaryIs>`).join('') +
    '</Polygon>'
  );
}

export function toKml(src: ExportSource): string {
  const nf = nameField(src.fields);
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
    `<name>${escapeXml(src.name)}</name>`,
  ];
  for (const f of src.features) {
    let s = '<Placemark>';
    if (nf && f.properties[nf] != null) s += `<name>${escapeXml(String(f.properties[nf]))}</name>`;
    const data = src.fields.filter((fl) => f.properties[fl.name] != null && f.properties[fl.name] !== '');
    if (data.length)
      s += '<ExtendedData>' + data.map((fl) => `<Data name="${escapeXml(fl.name)}"><value>${escapeXml(String(f.properties[fl.name]))}</value></Data>`).join('') + '</ExtendedData>';
    if (f.geometry) s += kmlGeometry(f.geometry);
    out.push(s + '</Placemark>');
  }
  out.push('</Document></kml>');
  return out.join('\n');
}

// ---------- GPX ----------

export function toGpx(src: ExportSource): string {
  if (src.geomType === 'Polygon') throw new Error('GPX can only store points and lines; choose another format for polygons');
  const nf = nameField(src.fields);
  const df = src.fields.find((f) => /^(desc|description|comment|cmt)$/i.test(f.name))?.name;
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="Terrane" xmlns="http://www.topografix.com/GPX/1/1">'];
  const trk: string[] = [];
  const pt = (tag: string, p: Position) => `<${tag} lat="${p[1]}" lon="${p[0]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ''}</${tag}>`;
  const seg = (c: Position[]) => `<trkseg>${c.map((p) => pt('trkpt', p)).join('')}</trkseg>`;
  let n = 0;
  for (const f of src.features) {
    const g = f.geometry;
    if (!g) continue;
    const name = nf && f.properties[nf] != null ? `<name>${escapeXml(String(f.properties[nf]))}</name>` : '';
    const desc = df && f.properties[df] != null ? `<desc>${escapeXml(String(f.properties[df]))}</desc>` : '';
    if (g.type === 'Point') {
      const p = g.coordinates;
      out.push(`<wpt lat="${p[1]}" lon="${p[0]}">${p[2] !== undefined ? `<ele>${p[2]}</ele>` : ''}${name}${desc}</wpt>`);
      n++;
    } else if (g.type === 'MultiPoint') {
      for (const p of g.coordinates) {
        out.push(`<wpt lat="${p[1]}" lon="${p[0]}">${name}${desc}</wpt>`);
        n++;
      }
    } else if (g.type === 'LineString') {
      trk.push(`<trk>${name}${desc}${seg(g.coordinates)}</trk>`);
      n++;
    } else if (g.type === 'MultiLineString') {
      trk.push(`<trk>${name}${desc}${g.coordinates.map(seg).join('')}</trk>`);
      n++;
    }
  }
  if (!n) throw new Error('There are no point or line features to export');
  out.push(...trk, '</gpx>');
  return out.join('\n');
}

// ---------- Shapefile ----------

export { shapefileFieldNames } from './shapefile';

export async function toShapefileZip(src: ExportSource): Promise<{ blob: Blob; renamed: Array<[string, string]> }> {
  const res = await buildShapefileZip(safeFileName(src.name), src.fields, src.features);
  return { blob: new Blob([res.zip as BlobPart], { type: 'application/zip' }), renamed: res.renamed };
}

/** Build the export payload for a format. */
export async function exportToBlob(
  format: ExportFormat,
  src: ExportSource,
  opts: { csvGeometry?: CsvGeometry } = {},
): Promise<{ blob: Blob; notes: string[] }> {
  const info = EXPORT_FORMATS.find((f) => f.id === format)!;
  switch (format) {
    case 'geojson':
      return { blob: new Blob([toGeoJSON(src)], { type: info.mime }), notes: [] };
    case 'kml':
      return { blob: new Blob([toKml(src)], { type: info.mime }), notes: [] };
    case 'gpx':
      return { blob: new Blob([toGpx(src)], { type: info.mime }), notes: [] };
    case 'csv':
      return { blob: new Blob(['﻿', toCsv(src, { geometry: opts.csvGeometry })], { type: info.mime }), notes: [] };
    case 'shapefile': {
      const { blob, renamed } = await toShapefileZip(src);
      return { blob, notes: renamed.length ? [`${renamed.length} field name(s) were shortened to 10 characters`] : [] };
    }
  }
}
