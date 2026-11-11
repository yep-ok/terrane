// Generalization tools: Simplify, Smooth (Bezier), Densify.
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import { M_PER_DEG, RAD, bboxOf, buildResult, coordsOf, gcInterp, haversine, mapCoords, mkFeature, toMeters, type Pos } from '../geo';
import { distP, layerP, numP, outP } from '../params';
import { ToolError, type GpFeature, type ToolDef } from '../types';
import { ticker, warnIfSkipped } from './common';

const CAT = 'Generalization';
const LINE_POLY = ['LineString', 'Polygon'] as const;

const countVertices = (fs: GpFeature[]) => fs.reduce((s, f) => s + coordsOf(f.geometry).length, 0);

export function simplifyGeom(g: Geometry, tolM: number): Geometry | null {
  const b = bboxOf(g);
  if (!b) return null;
  const lon0 = (b[0] + b[2]) / 2, lat0 = (b[1] + b[3]) / 2;
  const kx = Math.cos(lat0 * RAD) * M_PER_DEG;
  const fwd = (p: Pos): Pos => [(p[0] - lon0) * kx, (p[1] - lat0) * M_PER_DEG];
  const back = (p: Pos): Pos => [p[0] / kx + lon0, p[1] / M_PER_DEG + lat0];
  try {
    const r = turf.simplify({ type: 'Feature', properties: {}, geometry: mapCoords(g, fwd) } as any, { tolerance: tolM, highQuality: false });
    const out = mapCoords(r.geometry as Geometry, back);
    return coordsOf(out).length ? out : null;
  } catch {
    return null;
  }
}

export const simplify: ToolDef = {
  id: 'simplify',
  name: 'Simplify',
  category: CAT,
  description:
    'Reduces the number of vertices of lines and polygons with the Douglas-Peucker algorithm while keeping the overall shape. Vertices closer than the tolerance to the simplified line are removed. The tolerance is measured in meters on the ground.',
  keywords: ['generalize', 'reduce vertices', 'douglas peucker', 'thin', 'smaller'],
  params: [
    layerP('input', 'Input features', { help: 'Lines or polygons.', geom: [...LINE_POLY] }),
    distP('tolerance', 'Tolerance', { value: 100, unit: 'm' }, { help: 'Maximum allowed deviation from the original geometry.', min: 0 }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const tol = toMeters(ctx.params.tolerance);
    if (!(tol > 0)) throw new ToolError('The tolerance must be greater than zero.');
    const tick = ticker(ctx, input.features.length, 'Simplifying feature');
    let dropped = 0;
    const out: GpFeature[] = [];
    input.features.forEach((f, i) => {
      tick(i);
      if (!f.geometry) return void dropped++;
      const g = simplifyGeom(f.geometry, tol);
      if (g) out.push(mkFeature(g, { ...f.properties }, f.id));
      else dropped++;
    });
    warnIfSkipped(ctx, dropped, 'features could not be simplified and were');
    ctx.message(`Vertices reduced from ${countVertices(input.features).toLocaleString()} to ${countVertices(out).toLocaleString()}.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Smooth ----------

function smoothCoords(c: Pos[], closed: boolean, res: number, k: number): Pos[] {
  const pts = closed ? c.slice(0, -1) : c;
  const n = pts.length;
  if (n < 3) return c;
  const out: Pos[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = closed ? pts[(i - 1 + n) % n] : pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = closed ? pts[(i + 2) % n] : pts[Math.min(i + 2, n - 1)];
    const c1 = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    for (let s = 0; s < res; s++) {
      const t = s / res, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
      out.push([a * p1[0] + b * c1[0] + d * c2[0] + e * p2[0], a * p1[1] + b * c1[1] + d * c2[1] + e * p2[1]]);
    }
  }
  out.push(closed ? out[0] : pts[n - 1]);
  return out;
}

export function smoothGeom(g: Geometry, res: number, tension: number): Geometry {
  const k = tension / 6;
  if (g.type === 'LineString') return { type: 'LineString', coordinates: smoothCoords(g.coordinates, false, res, k) };
  if (g.type === 'MultiLineString') return { type: 'MultiLineString', coordinates: g.coordinates.map((l) => smoothCoords(l, false, res, k)) };
  if (g.type === 'Polygon') return { type: 'Polygon', coordinates: g.coordinates.map((r) => smoothCoords(r, true, res, k)) };
  if (g.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => smoothCoords(r, true, res, k))) };
  return g;
}

export const smooth: ToolDef = {
  id: 'smooth',
  name: 'Smooth Line / Polygon',
  category: CAT,
  description:
    'Replaces the straight segments of lines and polygon outlines with smooth Bezier curves that pass through the original vertices. Increase the tension for rounder curves. Endpoints of lines stay in place.',
  keywords: ['bezier', 'curve', 'round', 'spline', 'smoothing', 'catmull'],
  outputPrefix: 'Smooth',
  params: [
    layerP('input', 'Input features', { help: 'Lines or polygons.', geom: [...LINE_POLY] }),
    numP('resolution', 'Points per segment', 8, { help: 'How many curve points replace each original segment.', min: 2, max: 32, integer: true }),
    numP('tension', 'Tension', 1, { help: '0 keeps straight segments; 1 is a standard smooth curve; larger values bulge more.', min: 0, max: 2, step: 0.1 }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const res = Math.max(2, Math.min(32, Math.round(Number(ctx.params.resolution) || 8)));
    const tension = Math.max(0, Math.min(2, Number(ctx.params.tension) ?? 1));
    const out = input.features.filter((f) => f.geometry).map((f) => mkFeature(smoothGeom(f.geometry!, res, tension), { ...f.properties }, f.id));
    ctx.message(`Vertices increased from ${countVertices(input.features).toLocaleString()} to ${countVertices(out).toLocaleString()}.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Densify ----------

function densify(c: Pos[], spacingM: number): Pos[] {
  const out: Pos[] = [c[0]];
  for (let i = 1; i < c.length; i++) {
    const len = haversine(c[i - 1], c[i]);
    const n = Math.min(10000, Math.ceil(len / spacingM));
    for (let k = 1; k < n; k++) out.push(gcInterp(c[i - 1], c[i], k / n));
    out.push(c[i]);
  }
  return out;
}

export const densifyTool: ToolDef = {
  id: 'densify',
  name: 'Densify',
  category: CAT,
  description:
    'Adds vertices along the segments of lines and polygons so that no two consecutive vertices are farther apart than the spacing. New vertices follow the great circle between the original ones, which helps before reprojecting or buffering long segments.',
  keywords: ['add vertices', 'interpolate', 'segmentize', 'resample'],
  params: [
    layerP('input', 'Input features', { help: 'Lines or polygons.', geom: [...LINE_POLY] }),
    distP('spacing', 'Maximum spacing', { value: 1, unit: 'km' }, { help: 'Longest allowed distance between consecutive vertices.', min: 0 }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const sp = toMeters(ctx.params.spacing);
    if (!(sp > 0)) throw new ToolError('The spacing must be greater than zero.');
    const out = input.features.filter((f) => f.geometry).map((f) => {
      const g = f.geometry!;
      let r: Geometry = g;
      if (g.type === 'LineString') r = { type: 'LineString', coordinates: densify(g.coordinates, sp) };
      else if (g.type === 'MultiLineString') r = { type: 'MultiLineString', coordinates: g.coordinates.map((l) => densify(l, sp)) };
      else if (g.type === 'Polygon') r = { type: 'Polygon', coordinates: g.coordinates.map((l) => densify(l, sp)) };
      else if (g.type === 'MultiPolygon') r = { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((l) => densify(l, sp))) };
      return mkFeature(r, { ...f.properties }, f.id);
    });
    ctx.message(`Vertices increased from ${countVertices(input.features).toLocaleString()} to ${countVertices(out).toLocaleString()}.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

export const GENERALIZE_TOOLS: ToolDef[] = [simplify, smooth, densifyTool];
