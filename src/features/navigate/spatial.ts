// Spatial relations on lon/lat GeoJSON (pure; no map or React). Used by Select By Location and the
// drawn-shape selection tools.
import type { Geometry, LineString, Point, Polygon, Position } from 'geojson';
import { area, booleanIntersects, booleanWithin, centroid, polygonToLine } from '@turf/turf';
import RBush from 'ol/structs/RBush';
import type { Extent, Feat } from '../../core/types';

export type Relation = 'intersect' | 'within' | 'contains' | 'distance' | 'completelyWithin' | 'centerIn';
export const RELATIONS: Array<{ value: Relation; label: string }> = [
  { value: 'intersect', label: 'Intersect' },
  { value: 'distance', label: 'Are within a distance of' },
  { value: 'within', label: 'Are within' },
  { value: 'completelyWithin', label: 'Are completely within' },
  { value: 'contains', label: 'Contain' },
  { value: 'centerIn', label: 'Have their center in' },
];

type Simple = Point | LineString | Polygon;

/** Decompose Multi* and collections into single-part geometries. */
export function simpleParts(g: Geometry | null | undefined): Simple[] {
  if (!g) return [];
  switch (g.type) {
    case 'Point':
    case 'LineString':
    case 'Polygon':
      return [g];
    case 'MultiPoint':
      return g.coordinates.map((c) => ({ type: 'Point', coordinates: c }));
    case 'MultiLineString':
      return g.coordinates.map((c) => ({ type: 'LineString', coordinates: c }));
    case 'MultiPolygon':
      return g.coordinates.map((c) => ({ type: 'Polygon', coordinates: c }));
    case 'GeometryCollection':
      return g.geometries.flatMap(simpleParts);
  }
}

export function bboxOf(g: Geometry | null | undefined): Extent | null {
  const e: Extent = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: any) => {
    if (typeof c[0] === 'number') {
      if (c[0] < e[0]) e[0] = c[0];
      if (c[1] < e[1]) e[1] = c[1];
      if (c[0] > e[2]) e[2] = c[0];
      if (c[1] > e[3]) e[3] = c[1];
    } else for (const x of c) walk(x);
  };
  if (!g) return null;
  if (g.type === 'GeometryCollection') g.geometries.forEach((x) => { const b = bboxOf(x); if (b) walk([[b[0], b[1]], [b[2], b[3]]]); });
  else walk(g.coordinates);
  return e[0] === Infinity ? null : e;
}

const safe = (fn: () => boolean): boolean => {
  try {
    return fn();
  } catch {
    return false;
  }
};

export function intersects(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  const pa = simpleParts(a);
  const pb = simpleParts(b);
  for (const x of pa) for (const y of pb) if (safe(() => booleanIntersects(x, y))) return true;
  return false;
}

/** Every part of `a` lies within some part of `b` (boundary contact allowed for lines/polygons). */
export function within(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  const pa = simpleParts(a);
  const pb = simpleParts(b);
  if (!pa.length || !pb.length) return false;
  return pa.every((x) => pb.some((y) => safe(() => booleanWithin(x, y))));
}

/** Within, and not touching the boundary of any polygon part of `b`. */
export function completelyWithin(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  if (!within(a, b)) return false;
  for (const y of simpleParts(b)) {
    if (y.type !== 'Polygon') continue;
    const boundary = (polygonToLine(y) as any).geometry as Geometry;
    if (intersects(a, boundary)) return false;
  }
  return true;
}

export function centerIn(a: Geometry | null | undefined, b: Geometry | null | undefined): boolean {
  const parts = simpleParts(a);
  if (!parts.length) return false;
  const c = safeCentroid(a!);
  return c ? intersects(c, b) : false;
}
function safeCentroid(g: Geometry): Point | null {
  try {
    return centroid(g as any).geometry;
  } catch {
    return null;
  }
}

// ---------- distance ----------

const R = 6371008.8;
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
export function haversine(a: Position, b: Position): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLength(coords: Position[]): number {
  let n = 0;
  for (let i = 1; i < coords.length; i++) n += haversine(coords[i - 1], coords[i]);
  return n;
}

/** Spherical area (m²) of a lon/lat ring. */
export function ringArea(ring: Position[]): number {
  if (ring.length < 3) return 0;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring : [...ring, ring[0]];
  return area({ type: 'Polygon', coordinates: [closed] });
}

/** Distance in metres from p to segment ab, in a local equirectangular frame centred on p. */
function pointSegment(p: Position, a: Position, b: Position): number {
  const kx = Math.cos(p[1] * RAD) * R * RAD;
  const ky = R * RAD;
  const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
  const ax = wrap(a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const bx = wrap(b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Vertex sequences ("paths") of a simple part; a point is a one-vertex path. */
function paths(g: Simple): Position[][] {
  if (g.type === 'Point') return [[g.coordinates]];
  if (g.type === 'LineString') return [g.coordinates];
  return g.coordinates;
}

function pointToPaths(p: Position, ps: Position[][], best: number): number {
  for (const path of ps) {
    if (path.length === 1) best = Math.min(best, haversine(p, path[0]));
    else for (let i = 1; i < path.length; i++) best = Math.min(best, pointSegment(p, path[i - 1], path[i]));
    if (best === 0) return 0;
  }
  return best;
}

/** Minimum distance in metres between two geometries (0 when they intersect). Stops early once <= stopAt. */
export function minDistance(a: Geometry | null | undefined, b: Geometry | null | undefined, stopAt = 0): number {
  if (intersects(a, b)) return 0;
  let best = Infinity;
  const pa = simpleParts(a);
  const pb = simpleParts(b);
  for (const x of pa) {
    for (const y of pb) {
      const px = paths(x);
      const py = paths(y);
      for (const path of px) for (const v of path) best = pointToPaths(v, py, best);
      if (best <= stopAt) return best;
      for (const path of py) for (const v of path) best = pointToPaths(v, px, best);
      if (best <= stopAt) return best;
    }
  }
  return best;
}

// ---------- select by location ----------

export interface LocationParams {
  relation: Relation;
  /** Used by the 'distance' relation. */
  distanceM?: number;
}

const containsExtent = (outer: Extent, inner: Extent) => outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];

/**
 * Ids of target features that satisfy `relation` against at least one source feature.
 * Sources are spatially indexed so 10k x 10k stays fast; yields to the event loop between batches.
 */
export async function matchByLocation(
  targets: Feat[],
  sources: Feat[],
  params: LocationParams,
  opts: { onProgress?(done: number, total: number): void; shouldCancel?(): boolean } = {},
): Promise<number[]> {
  const tree = new RBush<{ geom: Geometry; bb: Extent }>();
  const boxes: Extent[] = [];
  const items: Array<{ geom: Geometry; bb: Extent }> = [];
  for (const s of sources) {
    const bb = bboxOf(s.geometry);
    if (!bb || !s.geometry) continue;
    boxes.push(bb);
    items.push({ geom: s.geometry, bb });
  }
  tree.load(boxes, items);

  const dist = Math.max(0, params.distanceM ?? 0);
  const out: number[] = [];
  let lastYield = Date.now();
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const tb = t.geometry ? bboxOf(t.geometry) : null;
    if (tb && t.geometry) {
      let query = tb;
      if (params.relation === 'distance' && dist > 0) {
        const dLat = dist / 111195;
        const maxLat = Math.min(89, Math.max(Math.abs(tb[1]), Math.abs(tb[3])) + dLat);
        const dLon = dist / (111195 * Math.max(0.02, Math.cos(maxLat * RAD)));
        query = [tb[0] - dLon, tb[1] - dLat, tb[2] + dLon, tb[3] + dLat];
      }
      for (const c of tree.getInExtent(query)) {
        if (testRelation(t.geometry, tb, c.geom, c.bb, params.relation, dist)) {
          out.push(t.id);
          break;
        }
      }
    }
    if (Date.now() - lastYield > 40) {
      opts.onProgress?.(i + 1, targets.length);
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
      if (opts.shouldCancel?.()) return out;
    }
  }
  opts.onProgress?.(targets.length, targets.length);
  return out;
}

function testRelation(t: Geometry, tb: Extent, s: Geometry, sb: Extent, relation: Relation, dist: number): boolean {
  switch (relation) {
    case 'intersect':
      return intersects(t, s);
    case 'within':
      return containsExtent(sb, tb) && within(t, s);
    case 'completelyWithin':
      return containsExtent(sb, tb) && completelyWithin(t, s);
    case 'contains':
      return containsExtent(tb, sb) && within(s, t);
    case 'centerIn':
      return centerIn(t, s);
    case 'distance':
      return minDistance(t, s, dist) <= dist;
  }
}
