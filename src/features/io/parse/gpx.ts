// GPX -> waypoints / routes / tracks layers.
import type { Position } from 'geojson';
import type { Feature, ParsedLayer } from '../model';
import { kidText, kids, parseXml, type XNode } from './xml';

function pt(n: XNode): Position | null {
  const lon = Number(n.attrs.lon);
  const lat = Number(n.attrs.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || n.attrs.lon === undefined) return null;
  const ele = kidText(n, 'ele');
  return ele !== '' && Number.isFinite(Number(ele)) ? [lon, lat, Number(ele)] : [lon, lat];
}

function meta(n: XNode, extra: string[] = []): Record<string, any> {
  const props: Record<string, any> = {};
  for (const k of ['name', 'desc', 'cmt', 'src', 'type', 'sym', 'time', ...extra]) {
    const v = kidText(n, k);
    if (v) props[k] = v;
  }
  return props;
}

export function parseGpx(text: string, fileName: string): ParsedLayer[] {
  const root = parseXml(text);
  if (root.name !== 'gpx') throw new Error('The file is not a GPX document');
  const waypoints: Feature[] = [];
  for (const w of kids(root, 'wpt')) {
    const p = pt(w);
    if (p) {
      const props = meta(w);
      if (p.length > 2) props.ele = p[2];
      waypoints.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p[0], p[1]] }, properties: props });
    }
  }
  const routes: Feature[] = [];
  for (const r of kids(root, 'rte')) {
    const c = kids(r, 'rtept').map(pt).filter((p): p is Position => !!p);
    if (c.length >= 2) routes.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: meta(r) });
  }
  const tracks: Feature[] = [];
  for (const t of kids(root, 'trk')) {
    const segs = kids(t, 'trkseg')
      .map((s) => kids(s, 'trkpt').map(pt).filter((p): p is Position => !!p))
      .filter((s) => s.length >= 2);
    if (!segs.length) continue;
    tracks.push({
      type: 'Feature',
      geometry: segs.length === 1 ? { type: 'LineString', coordinates: segs[0] } : { type: 'MultiLineString', coordinates: segs },
      properties: meta(t),
    });
  }
  const out: ParsedLayer[] = [];
  if (waypoints.length) out.push({ name: `${fileName} (waypoints)`, features: waypoints });
  if (routes.length) out.push({ name: `${fileName} (routes)`, features: routes });
  if (tracks.length) out.push({ name: `${fileName} (tracks)`, features: tracks });
  if (!out.length) throw new Error('The GPX file contains no waypoints, routes or tracks');
  return out;
}
