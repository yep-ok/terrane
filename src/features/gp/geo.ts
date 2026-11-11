// Pure geometry + table helpers shared by the tools. No React / OL / store.
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import type { Distance, Field, FieldType, GeomType, GpFeature, LayerData, StatName, StatSpec, ToolResult } from './types';

export type Pos = number[];
export type BBox = [number, number, number, number];
export type Poly = Pos[][]; // rings

export const R = 6371008.8;
export const RAD = Math.PI / 180;
export const M_PER_DEG = R * RAD;
export const UNIT_M = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 } as const;

export const toMeters = (d: Distance | number | undefined | null): number =>
  d == null ? 0 : typeof d === 'number' ? d : d.value * UNIT_M[d.unit];

export const isNum = (v: any): v is number => typeof v === 'number' && Number.isFinite(v);
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------- geometry decomposition ----------

export function geomFamily(g: Geometry | null | undefined): GeomType | null {
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
      return g.geometries.length ? geomFamily(g.geometries[0]) : null;
  }
}

export function polygonsOf(g: Geometry | null | undefined): Poly[] {
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates as Poly];
  if (g.type === 'MultiPolygon') return g.coordinates as Poly[];
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf);
  return [];
}
export function linesOf(g: Geometry | null | undefined): Pos[][] {
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates];
  if (g.type === 'MultiLineString') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(linesOf);
  return [];
}
export function pointsOf(g: Geometry | null | undefined): Pos[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(pointsOf);
  return [];
}
/** Lines plus polygon rings, i.e. everything with edges. */
export function edgeLinesOf(g: Geometry | null | undefined): Pos[][] {
  return [...linesOf(g), ...polygonsOf(g).flat()];
}
export function coordsOf(g: Geometry | null | undefined): Pos[] {
  const out: Pos[] = [];
  const walk = (c: any) => {
    if (typeof c[0] === 'number') out.push(c);
    else for (const x of c) walk(x);
  };
  if (!g) return out;
  if (g.type === 'GeometryCollection') return g.geometries.flatMap(coordsOf);
  walk(g.coordinates);
  return out;
}

export function geomFromParts(family: GeomType, parts: any[]): Geometry | null {
  if (!parts.length) return null;
  if (family === 'Point') return parts.length === 1 ? { type: 'Point', coordinates: parts[0] } : { type: 'MultiPoint', coordinates: parts };
  if (family === 'LineString') return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
  return parts.length === 1 ? { type: 'Polygon', coordinates: parts[0] } : { type: 'MultiPolygon', coordinates: parts };
}

/** Rebuild a geometry with every coordinate mapped through fn (structure preserved). */
export function mapCoords(g: Geometry, fn: (p: Pos) => Pos): Geometry {
  if (g.type === 'GeometryCollection') return { type: 'GeometryCollection', geometries: g.geometries.map((x) => mapCoords(x, fn)) };
  const walk = (c: any): any => (typeof c[0] === 'number' ? fn(c) : c.map(walk));
  return { type: g.type, coordinates: walk(g.coordinates) } as Geometry;
}

export function bboxOf(g: Geometry | null | undefined): BBox | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of coordsOf(g)) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return x0 === Infinity ? null : [x0, y0, x1, y1];
}
export const bboxHit = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
export function bboxUnion(boxes: Array<BBox | null>): BBox | null {
  let out: BBox | null = null;
  for (const b of boxes) {
    if (!b) continue;
    out = out ? [Math.min(out[0], b[0]), Math.min(out[1], b[1]), Math.max(out[2], b[2]), Math.max(out[3], b[3])] : [...b];
  }
  return out;
}
export const layerBBox = (l: LayerData): BBox | null => bboxUnion(l.features.map((f) => bboxOf(f.geometry)));

export function isEmptyGeom(g: Geometry | null | undefined): boolean {
  return !g || coordsOf(g).length === 0;
}

// ---------- spatial index (uniform grid) ----------

export class GridIndex {
  private cells: number[][];
  private big: number[] = [];
  private dim: number;
  private minx = 0;
  private miny = 0;
  private cw = 1;
  private ch = 1;
  private stamp: Int32Array;
  private visit = 0;
  constructor(private boxes: Array<BBox | null>) {
    const all = bboxUnion(boxes);
    const n = boxes.length;
    this.dim = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n))));
    this.cells = new Array(this.dim * this.dim);
    this.stamp = new Int32Array(n);
    if (!all) return;
    this.minx = all[0];
    this.miny = all[1];
    this.cw = (all[2] - all[0]) / this.dim || 1;
    this.ch = (all[3] - all[1]) / this.dim || 1;
    boxes.forEach((b, i) => {
      if (!b) return;
      const [cx0, cy0, cx1, cy1] = this.range(b);
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 64) {
        this.big.push(i);
        return;
      }
      for (let y = cy0; y <= cy1; y++)
        for (let x = cx0; x <= cx1; x++) (this.cells[y * this.dim + x] ??= []).push(i);
    });
  }
  private range(b: BBox): [number, number, number, number] {
    const d = this.dim;
    const c = (v: number, o: number, s: number) => clamp(Math.floor((v - o) / s), 0, d - 1);
    return [c(b[0], this.minx, this.cw), c(b[1], this.miny, this.ch), c(b[2], this.minx, this.cw), c(b[3], this.miny, this.ch)];
  }
  /** Indexes of items whose bbox intersects b. */
  query(b: BBox): number[] {
    const out: number[] = [];
    const v = ++this.visit;
    const take = (i: number) => {
      if (this.stamp[i] === v) return;
      this.stamp[i] = v;
      const bb = this.boxes[i];
      if (bb && bboxHit(bb, b)) out.push(i);
    };
    const [cx0, cy0, cx1, cy1] = this.range(b);
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const cell = this.cells[y * this.dim + x];
        if (cell) for (const i of cell) take(i);
      }
    for (const i of this.big) take(i);
    return out;
  }
}

// ---------- planar predicates ----------

export function pointInRing(p: Pos, ring: Pos[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function pointInPoly(p: Pos, poly: Poly): boolean {
  if (!poly.length || !pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}
export function pointInPolys(p: Pos, polys: Poly[], boxes?: BBox[]): boolean {
  for (let i = 0; i < polys.length; i++) {
    const b = boxes?.[i];
    if (b && (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3])) continue;
    if (pointInPoly(p, polys[i])) return true;
  }
  return false;
}
export function polyBox(poly: Poly): BBox {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly[0] ?? []) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

/** Segment p1-p2 vs p3-p4. Returns [t, u] parameters (0..1) or null (parallel / no hit). */
export function segIntersect(p1: Pos, p2: Pos, p3: Pos, p4: Pos): [number, number] | null {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (den === 0) return null;
  const ex = p3[0] - p1[0], ey = p3[1] - p1[1];
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}

/** A polygonal mask with fast point-in-mask and segment-crossing queries. */
export class Mask {
  polys: Poly[];
  boxes: BBox[];
  private index: GridIndex;
  constructor(public geom: Geometry) {
    this.polys = polygonsOf(geom);
    this.boxes = this.polys.map(polyBox);
    this.index = new GridIndex(this.boxes);
  }
  get empty() {
    return this.polys.length === 0;
  }
  contains(p: Pos): boolean {
    for (const i of this.index.query([p[0], p[1], p[0], p[1]])) if (pointInPoly(p, this.polys[i])) return true;
    return false;
  }
  /** Sorted parameters t in (0,1) where segment a-b crosses a mask boundary. */
  crossings(a: Pos, b: Pos): number[] {
    const ts: number[] = [];
    const box: BBox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    for (const i of this.index.query(box)) {
      for (const ring of this.polys[i]) {
        for (let k = 0; k < ring.length - 1; k++) {
          const h = segIntersect(a, b, ring[k], ring[k + 1]);
          if (h && h[0] > 1e-12 && h[0] < 1 - 1e-12) ts.push(h[0]);
        }
      }
    }
    return ts.sort((x, y) => x - y);
  }
  intersectsBox(b: BBox): boolean {
    return this.index.query(b).length > 0;
  }
}

// ---------- measurement ----------

export function haversine(a: Pos, b: Pos): number {
  const dLat = (b[1] - a[1]) * RAD;
  const dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
export function lineLengthM(c: Pos[]): number {
  let s = 0;
  for (let i = 1; i < c.length; i++) s += haversine(c[i - 1], c[i]);
  return s;
}
export function geomLengthM(g: Geometry | null | undefined): number {
  return linesOf(g).reduce((s, l) => s + lineLengthM(l), 0);
}
export function geomPerimeterM(g: Geometry | null | undefined): number {
  return polygonsOf(g).reduce((s, p) => s + p.reduce((t, r) => t + lineLengthM(r), 0), 0);
}
/** Geodesic area in square metres. */
export function geomAreaM2(g: Geometry | null | undefined): number {
  if (!polygonsOf(g).length) return 0;
  try {
    return turf.area({ type: 'Feature', properties: {}, geometry: g as any });
  } catch {
    return 0;
  }
}

export function pointSegDistM(p: Pos, a: Pos, b: Pos): number {
  const k = Math.cos(p[1] * RAD) * M_PER_DEG;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * M_PER_DEG;
  const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * M_PER_DEG;
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(-(ax * dx + ay * dy) / l2, 0, 1) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Minimum distance in metres between two geometries (0 when they touch, cross or nest). */
export function geomDistM(a: Geometry, b: Geometry): number {
  const la = edgeLinesOf(a), lb = edgeLinesOf(b);
  const ca = coordsOf(a), cb = coordsOf(b);
  let best = Infinity;
  if (!la.length && !lb.length) {
    for (const p of ca) for (const q of cb) best = Math.min(best, haversine(p, q));
    return best;
  }
  if (lb.length)
    for (const p of ca) {
      for (const l of lb) for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegDistM(p, l[i - 1], l[i]));
      if (best === 0) return 0;
    }
  if (la.length)
    for (const p of cb) {
      for (const l of la) for (let i = 1; i < l.length; i++) best = Math.min(best, pointSegDistM(p, l[i - 1], l[i]));
      if (best === 0) return 0;
    }
  const pa = polygonsOf(a), pb = polygonsOf(b);
  if (pb.length && ca.length && pointInPolys(ca[0], pb)) return 0;
  if (pa.length && cb.length && pointInPolys(cb[0], pa)) return 0;
  if (la.length && lb.length) {
    for (const x of la)
      for (let i = 1; i < x.length; i++)
        for (const y of lb) for (let j = 1; j < y.length; j++) if (segIntersect(x[i - 1], x[i], y[j - 1], y[j])) return 0;
  }
  return best;
}

/** Search bbox that is guaranteed to contain every point within r metres of box. */
export function expandBoxM(box: BBox, r: number): BBox {
  const dLat = r / 110574;
  const maxLat = Math.min(89, Math.max(Math.abs(box[1] - dLat), Math.abs(box[3] + dLat)));
  const dLon = r / (111320 * Math.max(0.02, Math.cos(maxLat * RAD)));
  return [box[0] - dLon, box[1] - dLat, box[2] + dLon, box[3] + dLat];
}

export interface IndexedGeom {
  geom: Geometry | null;
  box: BBox | null;
}
/** Nearest item to geom (distance in metres). maxM = 0 means unlimited. */
export function nearestItem(geom: Geometry, items: IndexedGeom[], index: GridIndex, maxM: number): { i: number; d: number } | null {
  const box = bboxOf(geom);
  if (!box) return null;
  const seen = new Set<number>();
  let best: { i: number; d: number } | null = null;
  let r = Math.max(50, maxM && maxM < 1000 ? maxM : 1000);
  const limit = maxM > 0 ? maxM : 4e7;
  for (let guard = 0; guard < 24; guard++) {
    for (const i of index.query(expandBoxM(box, r))) {
      if (seen.has(i)) continue;
      seen.add(i);
      const g = items[i].geom;
      if (!g) continue;
      const d = geomDistM(geom, g);
      if (!best || d < best.d) best = { i, d };
    }
    if (best && best.d <= r) break;
    if (r >= limit) break;
    r = Math.min(limit, r * 4);
  }
  if (!best) return null;
  return maxM > 0 && best.d > maxM ? null : best;
}

// ---------- boolean ops (polygons) ----------

const feat = (g: Geometry): any => ({ type: 'Feature', properties: {}, geometry: g });

export function asPolygonal(g: Geometry | null | undefined): Geometry | null {
  const polys = polygonsOf(g);
  return geomFromParts('Polygon', polys);
}

export function intersectPolys(a: Geometry, b: Geometry): Geometry | null {
  try {
    const r = turf.intersect(turf.featureCollection([feat(a), feat(b)]) as any);
    return r ? (r.geometry as Geometry) : null;
  } catch {
    return null;
  }
}
/** a minus every geometry in bs. */
export function differencePolys(a: Geometry, bs: Geometry[]): Geometry | null {
  if (!bs.length) return a;
  try {
    const r = turf.difference(turf.featureCollection([feat(a), ...bs.map(feat)]) as any);
    return r ? (r.geometry as Geometry) : null;
  } catch {
    return null;
  }
}
export function unionPolys(gs: Geometry[]): Geometry | null {
  const list = gs.filter((g) => polygonsOf(g).length);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  try {
    if (list.length <= 48) {
      const r = turf.union(turf.featureCollection(list.map(feat)) as any);
      return r ? (r.geometry as Geometry) : null;
    }
    const parts: Geometry[] = [];
    for (let i = 0; i < list.length; i += 32) {
      const u = unionPolys(list.slice(i, i + 32));
      if (u) parts.push(u);
    }
    return unionPolys(parts);
  } catch {
    // fall back to pairwise folding, skipping geometries that fail
    let acc: Geometry | null = null;
    for (const g of list) {
      if (!acc) acc = g;
      else {
        try {
          const r = turf.union(turf.featureCollection([feat(acc), feat(g)]) as any);
          if (r) acc = r.geometry as Geometry;
        } catch {
          /* skip invalid piece */
        }
      }
    }
    return acc;
  }
}

/**
 * Clip any geometry against a polygonal mask. keepInside=true gives the part inside
 * (Clip / Intersect), false gives the part outside (Erase).
 */
export function clipGeometry(g: Geometry, mask: Mask, keepInside: boolean): Geometry | null {
  const fam = geomFamily(g);
  if (!fam || mask.empty) return keepInside ? null : g;
  if (fam === 'Point') {
    const pts = pointsOf(g).filter((p) => mask.contains(p) === keepInside);
    return geomFromParts('Point', pts);
  }
  if (fam === 'LineString') {
    const out: Pos[][] = [];
    for (const line of linesOf(g)) {
      let cur: Pos[] = [];
      const flush = () => {
        if (cur.length > 1) out.push(cur);
        cur = [];
      };
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const ts = mask.crossings(a, b);
        const at = (t: number): Pos => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const cuts = [0, ...ts, 1];
        for (let k = 1; k < cuts.length; k++) {
          const t0 = cuts[k - 1], t1 = cuts[k];
          const p0 = t0 === 0 ? a : at(t0), p1 = t1 === 1 ? b : at(t1);
          const keep = mask.contains(at((t0 + t1) / 2)) === keepInside;
          if (keep) {
            if (!cur.length) cur.push(p0);
            else {
              const last = cur[cur.length - 1];
              if (last[0] !== p0[0] || last[1] !== p0[1]) cur.push(p0);
            }
            cur.push(p1);
          } else flush();
        }
      }
      flush();
    }
    return geomFromParts('LineString', out);
  }
  const maskGeom = mask.geom;
  const pg = asPolygonal(g);
  if (!pg) return null;
  return keepInside ? intersectPolys(pg, maskGeom) : differencePolys(pg, [maskGeom]);
}

// ---------- centroids ----------

function ringArea(r: Pos[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  return s / 2;
}
export function polyAreaPlanar(p: Poly): number {
  let a = Math.abs(ringArea(p[0]));
  for (let i = 1; i < p.length; i++) a -= Math.abs(ringArea(p[i]));
  return a;
}
function ringCentroid(r: Pos[]): { x: number; y: number; a: number } {
  let a = 0, x = 0, y = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
    a += f;
    x += (r[j][0] + r[i][0]) * f;
    y += (r[j][1] + r[i][1]) * f;
  }
  a /= 2;
  return a ? { x: x / (6 * a), y: y / (6 * a), a } : { x: r[0]?.[0] ?? 0, y: r[0]?.[1] ?? 0, a: 0 };
}

/** Area-weighted centroid for polygons, length-weighted for lines, mean for points. */
export function centroidOf(g: Geometry | null | undefined): Pos | null {
  if (!g) return null;
  const polys = polygonsOf(g);
  if (polys.length) {
    let A = 0, X = 0, Y = 0;
    for (const p of polys) {
      p.forEach((ring, i) => {
        const c = ringCentroid(ring);
        const a = Math.abs(c.a) * (i === 0 ? 1 : -1);
        A += a;
        X += c.x * a;
        Y += c.y * a;
      });
    }
    if (A) return [X / A, Y / A];
  }
  const lines = linesOf(g);
  if (lines.length) {
    let L = 0, X = 0, Y = 0;
    for (const l of lines)
      for (let i = 1; i < l.length; i++) {
        const d = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
        L += d;
        X += ((l[i][0] + l[i - 1][0]) / 2) * d;
        Y += ((l[i][1] + l[i - 1][1]) / 2) * d;
      }
    if (L) return [X / L, Y / L];
  }
  const c = coordsOf(g);
  if (!c.length) return null;
  return [c.reduce((s, p) => s + p[0], 0) / c.length, c.reduce((s, p) => s + p[1], 0) / c.length];
}

/** A point guaranteed to lie on / inside the geometry. */
export function pointInside(g: Geometry | null | undefined): Pos | null {
  if (!g) return null;
  const polys = polygonsOf(g);
  if (polys.length) {
    const sorted = [...polys].sort((a, b) => polyAreaPlanar(b) - polyAreaPlanar(a));
    for (const poly of sorted) {
      const c = centroidOf({ type: 'Polygon', coordinates: poly });
      if (c && pointInPoly(c, poly)) return c;
      const box = polyBox(poly);
      for (const frac of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const y = box[1] + (box[3] - box[1]) * frac;
        const xs: number[] = [];
        for (const ring of poly)
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1], b = ring[i];
            if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
          }
        xs.sort((p, q) => p - q);
        let bestW = -1, bx = 0;
        for (let i = 0; i + 1 < xs.length; i += 2)
          if (xs[i + 1] - xs[i] > bestW) {
            bestW = xs[i + 1] - xs[i];
            bx = (xs[i] + xs[i + 1]) / 2;
          }
        if (bestW >= 0) return [bx, y];
      }
      return poly[0][0];
    }
  }
  const lines = linesOf(g);
  if (lines.length) return alongLine(lines.reduce((a, b) => (lineLengthM(b) > lineLengthM(a) ? b : a)), 0.5);
  return pointsOf(g)[0] ?? null;
}

/** Interpolate along a great circle between a and b (f in 0..1). */
export function gcInterp(a: Pos, b: Pos, f: number): Pos {
  const lat1 = a[1] * RAD, lon1 = a[0] * RAD, lat2 = b[1] * RAD, lon2 = b[0] * RAD;
  const d = haversine(a, b) / R;
  if (d < 1e-12) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}

/** Point at fraction f of the length of a line. */
export function alongLine(c: Pos[], f: number): Pos {
  const total = lineLengthM(c);
  if (!total || c.length < 2) return c[0];
  let target = total * f;
  for (let i = 1; i < c.length; i++) {
    const d = haversine(c[i - 1], c[i]);
    if (target <= d || i === c.length - 1) return d ? gcInterp(c[i - 1], c[i], clamp(target / d, 0, 1)) : c[i];
    target -= d;
  }
  return c[c.length - 1];
}

// ---------- tables & statistics ----------

export function inferType(values: Iterable<any>): FieldType {
  let type: FieldType | null = null;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    let t: FieldType;
    if (typeof v === 'number') t = Number.isInteger(v) ? 'integer' : 'number';
    else if (typeof v === 'boolean') t = 'boolean';
    else t = 'string';
    if (type === null) type = t;
    else if (type !== t) {
      if ((type === 'integer' && t === 'number') || (type === 'number' && t === 'integer')) type = 'number';
      else return 'string';
    }
  }
  return type ?? 'string';
}

export const mkFeature = (geometry: Geometry | null, properties: Record<string, any>, id?: number | string): GpFeature => ({
  type: 'Feature',
  ...(id !== undefined ? { id } : {}),
  geometry,
  properties,
});

/** Assemble a ToolResult: orders properties by the schema, fills nulls and infers any missing types. */
export function buildResult(
  features: GpFeature[],
  opts: { geomType?: GeomType | null | 'auto'; fields?: Field[]; name?: string } = {},
): ToolResult {
  const fields: Field[] = [];
  const byName = new Map<string, Field>();
  for (const f of opts.fields ?? []) {
    if (!byName.has(f.name)) {
      const c = { name: f.name, type: f.type, ...(f.alias ? { alias: f.alias } : {}) };
      fields.push(c);
      byName.set(f.name, c);
    }
  }
  const extra: string[] = [];
  for (const f of features)
    for (const k in f.properties)
      if (!byName.has(k) && !extra.includes(k)) extra.push(k);
  for (const k of extra) {
    const c: Field = { name: k, type: inferType(features.map((f) => f.properties[k])) };
    fields.push(c);
    byName.set(k, c);
  }
  const out = features.map((f, i) => {
    const props: Record<string, any> = {};
    for (const fl of fields) props[fl.name] = f.properties[fl.name] ?? null;
    return { type: 'Feature' as const, id: i + 1, geometry: f.geometry, properties: props };
  });
  let geomType: GeomType | null;
  if (opts.geomType === undefined || opts.geomType === 'auto') {
    geomType = null;
    for (const f of out) {
      geomType = geomFamily(f.geometry);
      if (geomType) break;
    }
  } else geomType = opts.geomType;
  return { name: opts.name, geomType, fields, features: out };
}

/** Combine two schemas; colliding names from b get a numeric suffix. Returns rename map for b. */
export function mergeSchemas(a: Field[], b: Field[]): { fields: Field[]; rename: Map<string, string> } {
  const taken = new Set(a.map((f) => f.name));
  const rename = new Map<string, string>();
  const fields = [...a];
  for (const f of b) {
    let name = f.name;
    for (let i = 1; taken.has(name); i++) name = `${f.name}_${i}`;
    taken.add(name);
    rename.set(f.name, name);
    fields.push({ ...f, name });
  }
  return { fields, rename };
}
export function renamed(props: Record<string, any>, rename: Map<string, string>): Record<string, any> {
  const o: Record<string, any> = {};
  for (const k in props) o[rename.get(k) ?? k] = props[k];
  return o;
}

export function uniqueName(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let i = 1; ; i++) if (!set.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function groupKey(f: GpFeature, fields: string[]): string {
  return fields.length ? JSON.stringify(fields.map((n) => f.properties[n] ?? null)) : '';
}
export function groupBy(features: GpFeature[], fields: string[]): Map<string, GpFeature[]> {
  const m = new Map<string, GpFeature[]>();
  for (const f of features) {
    const k = groupKey(f, fields);
    const arr = m.get(k);
    if (arr) arr.push(f);
    else m.set(k, [f]);
  }
  return m;
}

export const fieldsOfNames = (l: LayerData, names: string[]): Field[] =>
  names.map((n) => l.fields.find((f) => f.name === n) ?? { name: n, type: 'string' as FieldType });

export function computeStat(values: any[], stat: StatName): number | string | boolean | null {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '');
  if (stat === 'count') return present.length;
  if (stat === 'first') return present.length ? present[0] : null;
  if (stat === 'last') return present.length ? present[present.length - 1] : null;
  const nums = present.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  switch (stat) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return nums.reduce((a, b) => Math.min(a, b), Infinity);
    case 'max':
      return nums.reduce((a, b) => Math.max(a, b), -Infinity);
    case 'range':
      return Math.max(...nums) - Math.min(...nums);
    case 'median': {
      const s = [...nums].sort((a, b) => a - b);
      const m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case 'std': {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length);
    }
  }
  return null;
}

export const statFieldName = (s: StatSpec) => `${s.stat.toUpperCase()}_${s.field}`;
export function statFields(specs: StatSpec[], src: Field[]): Field[] {
  return specs.map((s) => {
    const base = src.find((f) => f.name === s.field);
    const type: FieldType = s.stat === 'count' ? 'integer' : s.stat === 'first' || s.stat === 'last' ? base?.type ?? 'string' : 'number';
    return { name: statFieldName(s), type };
  });
}
export function statValues(specs: StatSpec[], rows: GpFeature[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const s of specs) out[statFieldName(s)] = computeStat(rows.map((r) => r.properties[s.field]), s.stat);
  return out;
}
/** Drop stat specs that reference fields the layer does not have (and exact duplicates). */
export function cleanStats(specs: StatSpec[] | undefined, layer: LayerData): StatSpec[] {
  const seen = new Set<string>();
  const out: StatSpec[] = [];
  for (const s of specs ?? []) {
    if (!s?.field || !layer.fields.some((f) => f.name === s.field)) continue;
    const k = statFieldName(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Copy of a feature's properties limited to a schema (never aliases the input object). */
export const copyProps = (p: Record<string, any>): Record<string, any> => ({ ...p });

/** Sort-friendly representation of a geometry used to find identical features. */
export function geomKey(g: Geometry | null): string {
  if (!g) return '';
  const r = (n: number) => Math.round(n * 1e9) / 1e9;
  return JSON.stringify(mapCoords(g, (p) => [r(p[0]), r(p[1])]));
}

export function featureCollection(fs: GpFeature[]): any {
  return { type: 'FeatureCollection', features: fs };
}
