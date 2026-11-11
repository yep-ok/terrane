// Pure geometry helpers for editing (GeoJSON, EPSG:4326). No OpenLayers / React
// imports so they can be unit-tested in node.
//
// Splitting is implemented with an exact planar noding approach rather than a
// buffered-line difference (which would leave a gap between the pieces):
//  * lines: intersections with the cutter are inserted as vertices and the line is
//    cut at them;
//  * polygons: the cutter is noded against the outer ring; every cutter piece that
//    runs through the interior from boundary to boundary is a "chord". Faces start
//    as the outer ring and each chord cuts the face that contains it into two rings
//    (walking the face ring between the chord's end points). Intersection points are
//    computed once and shared, so the pieces share vertices exactly. Holes are then
//    applied by intersecting each face with the original polygon. A cutter that
//    crosses itself is rejected for polygons.
import type { Geometry, Position } from 'geojson';
import {
  area as turfArea, buffer as turfBuffer, centerOfMass, feature, featureCollection, intersect as turfIntersect,
  kinks as turfKinks, length as turfLength, union as turfUnion,
} from '@turf/turf';

export type Family = 'Point' | 'LineString' | 'Polygon';

const EPS = 1e-12;
const SAME = 1e-10;

export function familyOf(g: Geometry | null | undefined): Family | null {
  if (!g) return null;
  switch (g.type) {
    case 'Point':
    case 'MultiPoint':
      return 'Point';
    case 'LineString':
    case 'MultiLineString':
      return 'LineString';
    case 'Polygon':
    case 'MultiPolygon':
      return 'Polygon';
    case 'GeometryCollection':
      return g.geometries.length ? familyOf(g.geometries[0]) : null;
  }
}

export const samePos = (a: Position, b: Position) => Math.abs(a[0] - b[0]) <= SAME && Math.abs(a[1] - b[1]) <= SAME;

// ---------- parts ----------

export function pointsOf(g: Geometry | null | undefined): Position[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(pointsOf);
  return [];
}
export function linesOf(g: Geometry | null | undefined): Position[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(linesOf);
  return [];
}
export function polygonsOf(g: Geometry | null | undefined): Position[][][] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}

/** Single geometry for one part, Multi* for several. */
export function fromParts(family: Family, parts: any[]): Geometry | null {
  if (!parts.length) return null;
  if (family === 'Point') return parts.length === 1 ? { type: 'Point', coordinates: parts[0] } : { type: 'MultiPoint', coordinates: parts };
  if (family === 'LineString') return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
  return parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts };
}

export function partCount(g: Geometry | null | undefined): number {
  if (!g) return 0;
  switch (g.type) {
    case 'MultiPoint':
    case 'MultiLineString':
    case 'MultiPolygon':
      return g.coordinates.length;
    case 'GeometryCollection':
      return g.geometries.reduce((n, x) => n + partCount(x), 0);
    default:
      return 1;
  }
}

// ---------- explode / merge ----------

/** Multipart -> single parts (a polygon keeps its holes). Single geometries return [g]. */
export function explodeGeometry(g: Geometry): Geometry[] {
  switch (g.type) {
    case 'MultiPoint':
      return g.coordinates.map((c) => ({ type: 'Point', coordinates: c }));
    case 'MultiLineString':
      return g.coordinates.map((c) => ({ type: 'LineString', coordinates: c }));
    case 'MultiPolygon':
      return g.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
    case 'GeometryCollection':
      return g.geometries.flatMap(explodeGeometry);
    default:
      return [g];
  }
}

/** Join lines that share end points into longer lines (greedy). */
export function joinLines(lines: Position[][]): Position[][] {
  const pool = lines.filter((l) => l.length >= 2).map((l) => l.slice());
  const out: Position[][] = [];
  while (pool.length) {
    let cur = pool.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        const a = cur[0], b = cur[cur.length - 1], c = l[0], d = l[l.length - 1];
        let next: Position[] | null = null;
        if (samePos(b, c)) next = cur.concat(l.slice(1));
        else if (samePos(b, d)) next = cur.concat(l.slice(0, -1).reverse());
        else if (samePos(a, d)) next = l.concat(cur.slice(1));
        else if (samePos(a, c)) next = l.slice().reverse().concat(cur.slice(1));
        if (next) {
          cur = next;
          pool.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * Merge geometries of one family: polygons are unioned (dissolving shared edges),
 * lines are combined (joined where end points meet), points become a MultiPoint.
 */
export function mergeGeometries(geoms: Array<Geometry | null | undefined>): Geometry | null {
  const list = geoms.filter(Boolean) as Geometry[];
  if (!list.length) return null;
  const fam = familyOf(list[0]);
  if (list.some((g) => familyOf(g) !== fam)) throw new Error('Features must share one geometry type');
  if (fam === 'Polygon') {
    const polys = list.flatMap(polygonsOf);
    if (polys.length === 1) return { type: 'Polygon', coordinates: polys[0] };
    const u = turfUnion(featureCollection(polys.map((p) => feature({ type: 'Polygon' as const, coordinates: p }))));
    return (u?.geometry as Geometry) ?? null;
  }
  if (fam === 'LineString') return fromParts('LineString', joinLines(list.flatMap(linesOf)));
  if (fam === 'Point') return fromParts('Point', list.flatMap(pointsOf));
  return null;
}

// ---------- affine transforms ----------

export function mapCoords(g: Geometry, fn: (p: Position) => Position): Geometry {
  const walk = (c: any): any => (typeof c[0] === 'number' ? fn(c) : c.map(walk));
  if (g.type === 'GeometryCollection') return { type: 'GeometryCollection', geometries: g.geometries.map((x) => mapCoords(x, fn)) };
  return { ...g, coordinates: walk(g.coordinates) } as Geometry;
}

export function bboxOf(geoms: Array<Geometry | null | undefined>): [number, number, number, number] | null {
  const e: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geoms) {
    if (!g) continue;
    mapCoords(g, (p) => {
      if (p[0] < e[0]) e[0] = p[0];
      if (p[1] < e[1]) e[1] = p[1];
      if (p[0] > e[2]) e[2] = p[0];
      if (p[1] > e[3]) e[3] = p[1];
      return p;
    });
  }
  return e[0] === Infinity ? null : e;
}

/** Pivot for rotate/scale: centre of mass for polygons, extent centre otherwise (or for several geometries). */
export function pivotOf(geoms: Array<Geometry | null | undefined>): Position | null {
  const list = geoms.filter(Boolean) as Geometry[];
  if (list.length === 1 && familyOf(list[0]) === 'Polygon') {
    try {
      return centerOfMass(feature(list[0])).geometry.coordinates;
    } catch {}
  }
  const e = bboxOf(list);
  return e ? [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2] : null;
}

/**
 * Rotate clockwise by `angleDeg` about `pivot` in a local equirectangular frame
 * (x scaled by cos(latitude)), so shapes keep their proportions on the ground.
 */
export function rotateGeometry(g: Geometry, angleDeg: number, pivot: Position): Geometry {
  const [lon0, lat0] = pivot;
  const k = Math.cos((lat0 * Math.PI) / 180) || 1e-9;
  const th = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(th), sin = Math.sin(th);
  return mapCoords(g, (p) => {
    const x = (p[0] - lon0) * k, y = p[1] - lat0;
    const out = [...p];
    out[0] = lon0 + (x * cos - y * sin) / k;
    out[1] = lat0 + x * sin + y * cos;
    return out;
  });
}

export function scaleGeometry(g: Geometry, factor: number, pivot: Position): Geometry {
  const [lon0, lat0] = pivot;
  return mapCoords(g, (p) => {
    const out = [...p];
    out[0] = lon0 + (p[0] - lon0) * factor;
    out[1] = lat0 + (p[1] - lat0) * factor;
    return out;
  });
}

export function translateGeometry(g: Geometry, dLon: number, dLat: number): Geometry {
  return mapCoords(g, (p) => {
    const out = [...p];
    out[0] = p[0] + dLon;
    out[1] = p[1] + dLat;
    return out;
  });
}

/** Reverse line direction (part order too, so a multipart line reads end to start). */
export function flipLine(g: Geometry): Geometry {
  if (g.type === 'LineString') return { type: 'LineString', coordinates: g.coordinates.slice().reverse() };
  if (g.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: g.coordinates.map((l) => l.slice().reverse()).reverse() };
  return g;
}

// ---------- vertices ----------

export interface VertexRef {
  /** Index path into the coordinates array (see removeVertex). */
  path: number[];
  coord: Position;
}

const ringOpen = (r: Position[]) => (r.length > 1 && samePos(r[0], r[r.length - 1]) ? r.slice(0, -1) : r.slice());
const closeRing = (r: Position[]) => (r.length && !samePos(r[0], r[r.length - 1]) ? [...r, r[0]] : r);

/** Every vertex of a geometry (polygon closing points excluded). */
export function listVertices(g: Geometry | null | undefined): VertexRef[] {
  if (!g) return [];
  const out: VertexRef[] = [];
  switch (g.type) {
    case 'Point':
      out.push({ path: [], coord: g.coordinates });
      break;
    case 'MultiPoint':
    case 'LineString':
      g.coordinates.forEach((c, i) => out.push({ path: [i], coord: c }));
      break;
    case 'MultiLineString':
      g.coordinates.forEach((l, p) => l.forEach((c, i) => out.push({ path: [p, i], coord: c })));
      break;
    case 'Polygon':
      g.coordinates.forEach((r, ri) => ringOpen(r).forEach((c, i) => out.push({ path: [ri, i], coord: c })));
      break;
    case 'MultiPolygon':
      g.coordinates.forEach((poly, p) => poly.forEach((r, ri) => ringOpen(r).forEach((c, i) => out.push({ path: [p, ri, i], coord: c }))));
      break;
    case 'GeometryCollection':
      break;
  }
  return out;
}

export const vertexCount = (g: Geometry | null | undefined) => listVertices(g).length;

/** Remove one vertex. Returns null when the result would be invalid (too few vertices). */
export function removeVertex(g: Geometry, path: number[]): Geometry | null {
  const dropRing = (ring: Position[], i: number): Position[] | null => {
    const open = ringOpen(ring);
    if (open.length <= 3 || i < 0 || i >= open.length) return null;
    open.splice(i, 1);
    return closeRing(open);
  };
  switch (g.type) {
    case 'MultiPoint': {
      if (g.coordinates.length <= 1) return null;
      return { type: 'MultiPoint', coordinates: g.coordinates.filter((_, i) => i !== path[0]) };
    }
    case 'LineString': {
      if (g.coordinates.length <= 2) return null;
      return { type: 'LineString', coordinates: g.coordinates.filter((_, i) => i !== path[0]) };
    }
    case 'MultiLineString': {
      const [p, i] = path;
      const line = g.coordinates[p];
      if (!line || line.length <= 2) return null;
      return { type: 'MultiLineString', coordinates: g.coordinates.map((l, k) => (k === p ? l.filter((_, j) => j !== i) : l)) };
    }
    case 'Polygon': {
      const [r, i] = path;
      const ring = g.coordinates[r] && dropRing(g.coordinates[r], i);
      if (!ring) return null;
      return { type: 'Polygon', coordinates: g.coordinates.map((x, k) => (k === r ? ring : x)) };
    }
    case 'MultiPolygon': {
      const [p, r, i] = path;
      const ring = g.coordinates[p]?.[r] && dropRing(g.coordinates[p][r], i);
      if (!ring) return null;
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((poly, k) => (k === p ? poly.map((x, j) => (j === r ? ring : x)) : poly)) };
    }
    default:
      return null;
  }
}

// ---------- measures ----------

export interface GeometrySummary {
  type: string;
  parts: number;
  vertices: number;
  /** Geodesic metres (lines). */
  length?: number;
  /** Geodesic square metres and perimeter metres (polygons). */
  area?: number;
  perimeter?: number;
  /** Point location. */
  point?: Position;
}

export function geometrySummary(g: Geometry | null | undefined): GeometrySummary | null {
  if (!g) return null;
  const s: GeometrySummary = { type: g.type, parts: partCount(g), vertices: vertexCount(g) };
  const fam = familyOf(g);
  try {
    if (fam === 'LineString') s.length = turfLength(feature(g), { units: 'kilometers' }) * 1000;
    if (fam === 'Polygon') {
      s.area = turfArea(feature(g));
      s.perimeter = turfLength(feature(g), { units: 'kilometers' }) * 1000;
    }
  } catch {}
  if (g.type === 'Point') s.point = g.coordinates;
  return s;
}

export type BufferUnits = 'meters' | 'kilometers' | 'feet' | 'miles' | 'nauticalmiles' | 'degrees';

export function bufferGeometry(g: Geometry, distance: number, units: BufferUnits): Geometry | null {
  const out: any = turfBuffer(feature(g) as any, distance, { units, steps: 16 });
  return (out?.geometry as Geometry) ?? null;
}

// ---------- splitting ----------

function segHit(a: Position, b: Position, c: Position, d: Position): { t: number; u: number } | null {
  const rx = b[0] - a[0], ry = b[1] - a[1];
  const sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-20) return null; // parallel / collinear: not a crossing
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) };
}
const lerp = (a: Position, b: Position, t: number): Position => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

interface Node {
  p: Position;
  cut: boolean;
}

/** Insert intersection points with `cutter` into the open/closed path and flag them. */
function nodePath(path: Position[], cutter: Position[], closed: boolean, shared?: Map<string, Position>): Node[] {
  const n = path.length;
  const segs = closed ? n : n - 1;
  const at: Array<Array<{ t: number; p: Position }>> = Array.from({ length: segs }, () => []);
  const vertexCut = new Array<boolean>(n).fill(false);
  for (let i = 0; i < segs; i++) {
    const a = path[i], b = path[(i + 1) % n];
    for (let j = 0; j < cutter.length - 1; j++) {
      const h = segHit(a, b, cutter[j], cutter[j + 1]);
      if (!h) continue;
      if (h.t <= EPS) vertexCut[i] = true;
      else if (h.t >= 1 - EPS) vertexCut[(i + 1) % n] = true;
      else {
        let p = h.u <= EPS ? cutter[j] : h.u >= 1 - EPS ? cutter[j + 1] : lerp(a, b, h.t);
        if (shared) {
          const key = `${i}|${j}`;
          const prev = shared.get(key);
          if (prev) p = prev;
          else shared.set(key, p);
        }
        at[i].push({ t: h.t, p });
      }
    }
  }
  const out: Node[] = [];
  const push = (p: Position, cut: boolean) => {
    const last = out[out.length - 1];
    if (last && samePos(last.p, p)) last.cut = last.cut || cut;
    else out.push({ p, cut });
  };
  for (let i = 0; i < n; i++) {
    push(path[i], vertexCut[i]);
    if (i < segs) for (const x of at[i].sort((m, k) => m.t - k.t)) push(x.p, true);
  }
  if (closed && out.length > 1 && samePos(out[0].p, out[out.length - 1].p)) {
    out[0].cut = out[0].cut || out[out.length - 1].cut;
    out.pop();
  }
  return out;
}

/** Split a polyline at its crossings with `cutter`. Returns the pieces (one piece = not split). */
export function splitLine(line: Position[], cutter: Position[]): Position[][] {
  const nodes = nodePath(line, cutter, false);
  const pieces: Position[][] = [];
  let cur: Position[] = [];
  nodes.forEach((nd, i) => {
    cur.push(nd.p);
    if (nd.cut && i > 0 && i < nodes.length - 1) {
      if (cur.length >= 2) pieces.push(cur);
      cur = [nd.p];
    }
  });
  if (cur.length >= 2) pieces.push(cur);
  return pieces;
}

function onSegment(p: Position, a: Position, b: Position): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  if (Math.abs(cross) / len > 1e-11) return false;
  return p[0] >= Math.min(a[0], b[0]) - SAME && p[0] <= Math.max(a[0], b[0]) + SAME && p[1] >= Math.min(a[1], b[1]) - SAME && p[1] <= Math.max(a[1], b[1]) + SAME;
}

/** Strictly inside an open ring (points on the boundary count as outside). */
export function pointInRing(p: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (onSegment(p, a, b)) return false;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function signedArea(ring: Position[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return s / 2;
}

/** Index of a position in a ring by exact-ish match. */
const indexIn = (ring: Position[], p: Position) => ring.findIndex((q) => samePos(q, p));

function walk(ring: Position[], from: number, to: number): Position[] {
  const out: Position[] = [];
  for (let i = from; ; i = (i + 1) % ring.length) {
    out.push(ring[i]);
    if (i === to) break;
  }
  return out;
}

/**
 * Split one polygon (outer ring + holes) by a polyline. Returns polygon coordinate
 * arrays, or null when the cutter does not cross the polygon from edge to edge.
 */
export function splitPolygon(rings: Position[][], cutter: Position[]): Position[][][] | null {
  if (!rings.length || cutter.length < 2) return null;
  const shared = new Map<string, Position>();
  const outer = ringOpen(rings[0]);
  if (outer.length < 3) return null;
  const ringNodes = nodePath(outer, cutter, true, shared).map((n) => n.p);

  // Node the cutter against the same ring, reusing the shared intersection points.
  const cutNodes = nodePath(cutter, closeRing(outer), false);
  // Replace cutter-side intersection coordinates with the ring-side ones so they match exactly.
  for (const nd of cutNodes) {
    if (!nd.cut) continue;
    const k = indexIn(ringNodes, nd.p);
    if (k >= 0) nd.p = ringNodes[k];
  }

  // Chords: cutter pieces between two boundary nodes whose interior lies inside the ring.
  const chords: Position[][] = [];
  let start = -1;
  cutNodes.forEach((nd, i) => {
    if (!nd.cut) return;
    if (start >= 0) {
      const piece = cutNodes.slice(start, i + 1).map((x) => x.p);
      const mid = lerp(piece[0], piece[1], 0.5);
      if (piece.length >= 2 && pointInRing(mid, outer)) chords.push(piece);
    }
    start = i;
  });
  if (!chords.length) return null;
  if (chords.length > 1) {
    const k = turfKinks(feature({ type: 'LineString' as const, coordinates: cutter }));
    if (k.features.length) throw new Error('The split line crosses itself');
  }

  let faces: Position[][] = [ringNodes];
  for (const chord of chords) {
    const mid = lerp(chord[0], chord[1], 0.5);
    const fi = faces.findIndex((f) => pointInRing(mid, f));
    if (fi < 0) continue;
    const f = faces[fi];
    const ia = indexIn(f, chord[0]);
    const ib = indexIn(f, chord[chord.length - 1]);
    if (ia < 0 || ib < 0 || ia === ib) continue;
    const inner = chord.slice(1, -1);
    const r1 = [...walk(f, ia, ib), ...inner.slice().reverse()];
    const r2 = [...walk(f, ib, ia), ...inner];
    if (r1.length < 3 || r2.length < 3) continue;
    faces.splice(fi, 1, r1, r2);
  }
  if (faces.length < 2) return null;
  faces = faces.map((r) => (signedArea(r) < 0 ? r.slice().reverse() : r));

  const holes = rings.slice(1);
  if (!holes.length) return faces.map((r) => [closeRing(r)]);
  const original = feature({ type: 'Polygon' as const, coordinates: rings });
  const out: Position[][][] = [];
  for (const r of faces) {
    const hit = turfIntersect(featureCollection([feature({ type: 'Polygon' as const, coordinates: [closeRing(r)] }), original]));
    if (hit) out.push(...polygonsOf(hit.geometry as Geometry));
  }
  return out.length > 1 ? out : null;
}

/**
 * Split a line or polygon geometry by a cutter polyline. Returns the resulting
 * geometries (each split piece is single-part; parts of a multipart input that the
 * cutter misses are kept together as one extra geometry), or null when nothing was cut.
 */
export function splitGeometry(g: Geometry, cutter: Position[]): Geometry[] | null {
  const fam = familyOf(g);
  if (fam === 'Polygon') {
    const pieces: Position[][][] = [];
    const untouched: Position[][][] = [];
    for (const part of polygonsOf(g)) {
      const r = splitPolygon(part, cutter);
      if (r && r.length > 1) pieces.push(...r);
      else untouched.push(part);
    }
    if (!pieces.length) return null;
    const out: Geometry[] = pieces.map((p) => ({ type: 'Polygon', coordinates: p }));
    const rest = fromParts('Polygon', untouched);
    if (rest) out.push(rest);
    return out;
  }
  if (fam === 'LineString') {
    const pieces: Position[][] = [];
    const untouched: Position[][] = [];
    for (const part of linesOf(g)) {
      const r = splitLine(part, cutter);
      if (r.length > 1) pieces.push(...r);
      else untouched.push(part);
    }
    if (!pieces.length) return null;
    const out: Geometry[] = pieces.map((p) => ({ type: 'LineString', coordinates: p }));
    const rest = fromParts('LineString', untouched);
    if (rest) out.push(rest);
    return out;
  }
  return null;
}

/** Is a freshly drawn geometry usable (enough distinct vertices)? */
export function isValidSketch(g: Geometry | null | undefined): boolean {
  if (!g) return false;
  if (g.type === 'Point') return g.coordinates.every(Number.isFinite);
  if (g.type === 'LineString') {
    const pts = g.coordinates.filter((p, i, a) => i === 0 || !samePos(p, a[i - 1]));
    return pts.length >= 2;
  }
  if (g.type === 'Polygon') {
    const ring = ringOpen(g.coordinates[0] ?? []).filter((p, i, a) => i === 0 || !samePos(p, a[i - 1]));
    return ring.length >= 3 && Math.abs(signedArea(ring)) > 0;
  }
  return true;
}

/** Ensure polygon rings are closed and drop consecutive duplicate vertices. */
export function cleanGeometry(g: Geometry): Geometry {
  const dedupe = (l: Position[]) => l.filter((p, i, a) => i === 0 || !samePos(p, a[i - 1]));
  switch (g.type) {
    case 'LineString':
      return { type: 'LineString', coordinates: dedupe(g.coordinates) };
    case 'MultiLineString':
      return { type: 'MultiLineString', coordinates: g.coordinates.map(dedupe) };
    case 'Polygon':
      return { type: 'Polygon', coordinates: g.coordinates.map((r) => closeRing(dedupe(r))) };
    case 'MultiPolygon':
      return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => closeRing(dedupe(r)))) };
    default:
      return g;
  }
}
