// Feature tools: conversion between geometry types, bounding geometry, Select, Calculate Geometry...
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import { compileWhere } from '../../../core/expr';
import {
  GridIndex, RAD, M_PER_DEG, alongLine, bboxOf, buildResult, centroidOf, coordsOf, fieldsOfNames, geomAreaM2, geomFamily, geomFromParts, geomKey, geomLengthM,
  geomPerimeterM, groupBy, linesOf, mkFeature, pointInside, pointsOf, polygonsOf, segIntersect, uniqueName, type Pos,
} from '../geo';
import { ANY_GEOM, LINE, POLY, POINT, boolP, choiceP, fieldP, fieldsP, layerP, multiP, outP, whereP } from '../params';
import { ToolError, type Field, type GpFeature, type ToolDef } from '../types';
import { AREA_M2, AREA_UNITS, LENGTH_M, LENGTH_UNITS, ticker, warnIfSkipped } from './common';

const CAT = 'Features';

// ---------- Feature To Point ----------

export const featureToPoint: ToolDef = {
  id: 'feature-to-point',
  name: 'Feature To Point',
  category: CAT,
  description:
    'Creates one point for each input feature. "Centroid" is the geometric center (area-weighted for polygons); "Inside" guarantees the point lies on or inside the feature, which matters for crescent-shaped or multipart polygons. Attributes are copied.',
  keywords: ['centroid', 'center', 'label point', 'representative point', 'convert'],
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }),
    choiceP('method', 'Point location', 'centroid', [['centroid', 'Centroid'], ['inside', 'Inside (guaranteed on feature)']], { help: 'Where to place the point on each feature.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const inside = ctx.params.method === 'inside';
    const out: GpFeature[] = [];
    for (const f of input.features) {
      const c = inside ? pointInside(f.geometry) : centroidOf(f.geometry);
      if (c) out.push(mkFeature({ type: 'Point', coordinates: c }, { ...f.properties }, f.id));
    }
    warnIfSkipped(ctx, input.features.length - out.length, 'features without geometry');
    return buildResult(out, { geomType: 'Point', fields: input.fields });
  },
};

// ---------- Feature Vertices To Points ----------

export const verticesToPoints: ToolDef = {
  id: 'feature-vertices-to-points',
  name: 'Feature Vertices To Points',
  category: CAT,
  description:
    'Converts the vertices of lines and polygons into points. Choose all vertices, only the start or end of each line or ring, both ends, or the midpoint along each part. Each point carries the source attributes plus ORIG_FID.',
  keywords: ['nodes', 'endpoints', 'start', 'end', 'midpoint', 'convert'],
  params: [
    layerP('input', 'Input features', { help: 'Lines or polygons (points are copied as they are).', geom: ANY_GEOM }),
    choiceP('which', 'Vertices', 'all', [['all', 'All vertices'], ['start', 'Start'], ['end', 'End'], ['ends', 'Start and end'], ['mid', 'Midpoint']], { help: 'Which vertices of each line or ring to output.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const which = String(ctx.params.which);
    const orig = uniqueName('ORIG_FID', input.fields.map((f) => f.name));
    const vtx = uniqueName('VERTEX_INDEX', [...input.fields.map((f) => f.name), orig]);
    const out: GpFeature[] = [];
    const tick = ticker(ctx, input.features.length, 'Converting feature');
    input.features.forEach((f, fi) => {
      tick(fi);
      if (!f.geometry) return;
      const base = { ...f.properties, [orig]: f.id ?? fi + 1 };
      const add = (c: Pos, i: number) => out.push(mkFeature({ type: 'Point', coordinates: c }, { ...base, [vtx]: i }));
      for (const p of pointsOf(f.geometry)) add(p, 0);
      const parts: Pos[][] = [...linesOf(f.geometry), ...polygonsOf(f.geometry).flat()];
      for (const part of parts) {
        const isRing = part.length > 3 && part[0][0] === part[part.length - 1][0] && part[0][1] === part[part.length - 1][1];
        const pts = isRing ? part.slice(0, -1) : part;
        if (!pts.length) continue;
        if (which === 'all') pts.forEach((c, i) => add(c, i));
        else if (which === 'start') add(pts[0], 0);
        else if (which === 'end') add(isRing ? pts[0] : pts[pts.length - 1], pts.length - 1);
        else if (which === 'ends') {
          add(pts[0], 0);
          if (!isRing && pts.length > 1) add(pts[pts.length - 1], pts.length - 1);
        } else add(alongLine(part, 0.5), -1);
      }
    });
    const fields: Field[] = [...input.fields, { name: orig, type: 'integer' }, { name: vtx, type: 'integer' }];
    ctx.message(`${out.length.toLocaleString()} points created.`);
    return buildResult(out, { geomType: 'Point', fields });
  },
};

// ---------- Polygon To Line ----------

export const polygonToLine: ToolDef = {
  id: 'polygon-to-line',
  name: 'Polygon To Line',
  category: CAT,
  description: 'Converts polygon boundaries (outer rings and holes) to lines. Each polygon becomes one line feature with its attributes.',
  keywords: ['boundary', 'outline', 'perimeter', 'convert', 'ring'],
  params: [layerP('input', 'Input polygons', { help: 'Polygon features.', geom: POLY }), outP()],
  run(ctx) {
    const input = ctx.layer('input');
    const out: GpFeature[] = [];
    for (const f of input.features) {
      const g = geomFromParts('LineString', polygonsOf(f.geometry).flat());
      if (g) out.push(mkFeature(g, { ...f.properties }, f.id));
    }
    return buildResult(out, { geomType: 'LineString', fields: input.fields });
  },
};

// ---------- Feature To Polygon ----------

/** Split every line at its intersections with the others so polygonize sees a proper graph. */
export function nodeLines(lines: Pos[][]): Pos[][] {
  const segs: Array<[Pos, Pos]> = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) if (l[i][0] !== l[i - 1][0] || l[i][1] !== l[i - 1][1]) segs.push([l[i - 1], l[i]]);
  const boxes = segs.map(([a, b]) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] as [number, number, number, number]);
  const index = new GridIndex(boxes);
  const splits: Array<Array<{ t: number; p: Pos }>> = segs.map(() => []);
  const E = 1e-12;
  segs.forEach(([a, b], i) => {
    for (const j of index.query(boxes[i])) {
      if (j <= i) continue;
      const [c, d] = segs[j];
      const h = segIntersect(a, b, c, d);
      if (!h) continue;
      const [t, u] = h;
      let p: Pos;
      if (t < E) p = a;
      else if (t > 1 - E) p = b;
      else if (u < E) p = c;
      else if (u > 1 - E) p = d;
      else p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      splits[i].push({ t, p });
      splits[j].push({ t: u, p });
    }
  });
  const out: Pos[][] = [];
  segs.forEach(([a, b], i) => {
    const pts = [{ t: 0, p: a }, ...splits[i].sort((x, y) => x.t - y.t), { t: 1, p: b }];
    for (let k = 1; k < pts.length; k++) {
      const p = pts[k - 1].p, q = pts[k].p;
      if (p[0] !== q[0] || p[1] !== q[1]) out.push([p, q]);
    }
  });
  return out;
}

export const featureToPolygon: ToolDef = {
  id: 'feature-to-polygon',
  name: 'Feature To Polygon',
  category: CAT,
  description:
    'Builds polygons from the closed areas enclosed by lines. Lines are first split wherever they cross or touch, so a street network or digitised boundaries become a set of non-overlapping polygons. Polygon inputs contribute their boundaries. Dangling lines are ignored.',
  keywords: ['polygonize', 'lines to polygons', 'enclosed areas', 'blocks', 'close'],
  params: [layerP('input', 'Input features', { help: 'Lines (or polygons) whose boundaries enclose areas.', geom: ['LineString', 'Polygon'] }), outP()],
  run(ctx) {
    const input = ctx.layer('input');
    const lines: Pos[][] = [];
    for (const f of input.features) lines.push(...linesOf(f.geometry), ...polygonsOf(f.geometry).flat());
    if (!lines.length) throw new ToolError('The input has no line work.');
    ctx.progress(0.2, 'Noding lines');
    const noded = nodeLines(lines);
    ctx.progress(0.5, `Polygonizing ${noded.length.toLocaleString()} segments`);
    let polys: any;
    try {
      polys = turf.polygonize(turf.featureCollection(noded.map((c) => turf.lineString(c))) as any);
    } catch (e: any) {
      throw new ToolError(`The lines could not be polygonized: ${e?.message ?? e}`);
    }
    const out = (polys.features as any[]).map((p, i) => mkFeature(p.geometry as Geometry, { Polygon_ID: i + 1 }));
    ctx.message(`${out.length.toLocaleString()} polygons created.`);
    return buildResult(out, { geomType: 'Polygon', fields: [{ name: 'Polygon_ID', type: 'integer' }] });
  },
};

// ---------- Points To Line ----------

export const pointsToLine: ToolDef = {
  id: 'points-to-line',
  name: 'Points To Line',
  category: CAT,
  description:
    'Connects points into lines, in the order of a sort field (or feature order). Group fields create one line per distinct value, e.g. one track per vehicle. Groups with fewer than two points are skipped.',
  keywords: ['track', 'path', 'connect', 'trajectory', 'gps'],
  params: [
    layerP('input', 'Input points', { help: 'Point features.', geom: POINT }),
    fieldsP('group', 'Group fields', 'input', { help: 'One line is created for every distinct combination of values. Leave empty for a single line.' }),
    fieldP('sort', 'Sort field', 'input', { help: 'Points are connected in ascending order of this field. Empty uses the feature order.', optional: true, allowNone: true }),
    boolP('close', 'Close lines', false, { help: 'Connect the last point back to the first.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const names: string[] = (ctx.params.group ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
    const sort: string = ctx.params.sort || '';
    const groups = groupBy(input.features.filter((f) => f.geometry), names);
    const countName = uniqueName('Point_Count', names);
    const out: GpFeature[] = [];
    let skipped = 0;
    for (const rows of groups.values()) {
      const sorted = sort
        ? [...rows].sort((a, b) => {
            const x = a.properties[sort], y = b.properties[sort];
            if (x == null) return y == null ? 0 : 1;
            if (y == null) return -1;
            return typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
          })
        : rows;
      const coords = sorted.flatMap((r) => pointsOf(r.geometry));
      if (coords.length < 2) {
        skipped++;
        continue;
      }
      if (ctx.params.close && coords.length > 2) coords.push(coords[0]);
      const props: Record<string, any> = {};
      for (const n of names) props[n] = rows[0].properties[n] ?? null;
      props[countName] = coords.length - (ctx.params.close && coords.length > 2 ? 1 : 0);
      out.push(mkFeature({ type: 'LineString', coordinates: coords }, props));
    }
    warnIfSkipped(ctx, skipped, 'groups with fewer than two points');
    return buildResult(out, { geomType: 'LineString', fields: [...fieldsOfNames(input, names), { name: countName, type: 'integer' }] });
  },
};

// ---------- Minimum Bounding Geometry ----------

function convexHull(points: Pos[]): Pos[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
  if (uniq.length < 3) return uniq;
  const cross = (o: Pos, a: Pos, b: Pos) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pos[] = [];
  for (const p of uniq) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pos[] = [];
  for (const p of [...uniq].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Smallest enclosing circle (iterative Welzl) in a local metric projection. */
export function minimumCircle(points: Pos[]): { center: Pos; radius: number } | null {
  if (!points.length) return null;
  const lat0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const kx = Math.cos(lat0 * RAD) * M_PER_DEG;
  const P = convexHull(points).map((p) => [(p[0] - lon0) * kx, (p[1] - lat0) * M_PER_DEG]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = P.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [P[i], P[j]] = [P[j], P[i]];
  }
  type C = { x: number; y: number; r: number };
  const inC = (c: C, p: number[]) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r * (1 + 1e-12) + 1e-9;
  const c2 = (a: number[], b: number[]): C => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const c3 = (a: number[], b: number[], c: number[]): C => {
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1];
    const d = 2 * (bx * cy - by * cx);
    if (Math.abs(d) < 1e-12) {
      const cand = [c2(a, b), c2(a, c), c2(b, c)];
      return cand.reduce((m, k) => (k.r > m.r ? k : m));
    }
    const ux = (cy * (bx * bx + by * by) - by * (cx * cx + cy * cy)) / d;
    const uy = (bx * (cx * cx + cy * cy) - cx * (bx * bx + by * by)) / d;
    return { x: a[0] + ux, y: a[1] + uy, r: Math.hypot(ux, uy) };
  };
  let c: C = { x: P[0][0], y: P[0][1], r: 0 };
  for (let i = 1; i < P.length; i++) {
    if (inC(c, P[i])) continue;
    c = { x: P[i][0], y: P[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inC(c, P[j])) continue;
      c = c2(P[i], P[j]);
      for (let k = 0; k < j; k++) if (!inC(c, P[k])) c = c3(P[i], P[j], P[k]);
    }
  }
  return { center: [lon0 + c.x / kx, lat0 + c.y / M_PER_DEG], radius: c.r };
}

function boundingGeom(kind: string, coords: Pos[]): { g: Geometry; radius?: number } | null {
  if (coords.length < 2) return null;
  if (kind === 'envelope') {
    const b = bboxOf({ type: 'MultiPoint', coordinates: coords })!;
    if (b[0] === b[2] || b[1] === b[3]) return null;
    return { g: { type: 'Polygon', coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] } };
  }
  if (kind === 'circle') {
    const c = minimumCircle(coords);
    if (!c || c.radius <= 0) return null;
    const circ = turf.circle(c.center, c.radius / 1000, { steps: 72, units: 'kilometers' });
    return { g: circ.geometry as Geometry, radius: c.radius };
  }
  const h = convexHull(coords);
  if (h.length < 3) return null;
  return { g: { type: 'Polygon', coordinates: [[...h, h[0]]] } };
}

export const minimumBoundingGeometry: ToolDef = {
  id: 'minimum-bounding-geometry',
  name: 'Minimum Bounding Geometry',
  category: CAT,
  description:
    'Creates the smallest convex hull, axis-aligned envelope or enclosing circle around features. Run it per feature, over the whole layer, or per group of field values. Single points and straight lines have no area and are skipped.',
  keywords: ['convex hull', 'envelope', 'extent', 'bounding box', 'enclosing circle', 'minimum'],
  outputPrefix: 'MBG',
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }),
    choiceP('kind', 'Geometry type', 'convex_hull', [['convex_hull', 'Convex hull'], ['envelope', 'Envelope (rectangle)'], ['circle', 'Circle']], { help: 'The shape that encloses the features.' }),
    choiceP('group', 'Group option', 'all', [['all', 'All features together'], ['each', 'Each feature separately'], ['list', 'By field values']], { help: 'What each output shape should enclose.' }),
    fieldsP('fields', 'Group fields', 'input', { help: 'Features with identical values in these fields share one shape.', showIf: (v) => v.group === 'list' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const kind = String(ctx.params.kind), group = String(ctx.params.group);
    const names: string[] = group === 'list' ? (ctx.params.fields ?? []).filter((n: string) => input.fields.some((f) => f.name === n)) : [];
    const feats = input.features.filter((f) => f.geometry && coordsOf(f.geometry).length);
    const buckets: GpFeature[][] = group === 'each' ? feats.map((f) => [f]) : [...groupBy(feats, names).values()];
    const countName = uniqueName('Feature_Count', [...input.fields.map((f) => f.name), ...names]);
    const radName = uniqueName('Radius_m', [...input.fields.map((f) => f.name), countName]);
    const out: GpFeature[] = [];
    let skipped = 0;
    for (const rows of buckets) {
      const res = boundingGeom(kind, rows.flatMap((r) => coordsOf(r.geometry)));
      if (!res) {
        skipped++;
        continue;
      }
      const props: Record<string, any> =
        group === 'each' ? { ...rows[0].properties } : Object.fromEntries(names.map((n) => [n, rows[0].properties[n] ?? null]));
      if (group !== 'each') props[countName] = rows.length;
      if (kind === 'circle') props[radName] = res.radius;
      out.push(mkFeature(res.g, props, group === 'each' ? rows[0].id : undefined));
    }
    warnIfSkipped(ctx, skipped, 'groups too small to enclose');
    const base = group === 'each' ? input.fields : [...fieldsOfNames(input, names), { name: countName, type: 'integer' as const }];
    return buildResult(out, { geomType: 'Polygon', fields: kind === 'circle' ? [...base, { name: radName, type: 'number' }] : base });
  },
};

// ---------- Multipart To Singlepart ----------

export const multipartToSinglepart: ToolDef = {
  id: 'multipart-to-singlepart',
  name: 'Multipart To Singlepart',
  category: CAT,
  description: 'Splits multipart features (e.g. an archipelago stored as one polygon) into one feature per part. Attributes are copied and ORIG_FID records the source feature.',
  keywords: ['explode', 'split', 'singlepart', 'multi', 'parts'],
  params: [layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }), outP()],
  run(ctx) {
    const input = ctx.layer('input');
    const orig = uniqueName('ORIG_FID', input.fields.map((f) => f.name));
    const out: GpFeature[] = [];
    input.features.forEach((f, i) => {
      if (!f.geometry) return;
      const props = { ...f.properties, [orig]: f.id ?? i + 1 };
      const fam = input.geomType;
      const parts: Geometry[] =
        fam === 'Polygon' ? polygonsOf(f.geometry).map((c) => ({ type: 'Polygon', coordinates: c }))
        : fam === 'LineString' ? linesOf(f.geometry).map((c) => ({ type: 'LineString', coordinates: c }))
        : pointsOf(f.geometry).map((c) => ({ type: 'Point', coordinates: c }));
      for (const g of parts) out.push(mkFeature(g, { ...props }));
    });
    ctx.message(`${input.features.length.toLocaleString()} features split into ${out.length.toLocaleString()} parts.`);
    return buildResult(out, { geomType: input.geomType, fields: [...input.fields, { name: orig, type: 'integer' }] });
  },
};

// ---------- Delete Identical ----------

export const deleteIdentical: ToolDef = {
  id: 'delete-identical',
  name: 'Delete Identical',
  category: CAT,
  description:
    'Finds features that are identical in the chosen fields and/or geometry and keeps only the first of each set. Writes a new layer; the input is untouched.',
  keywords: ['duplicates', 'dedupe', 'remove duplicates', 'unique'],
  params: [
    layerP('input', 'Input features', { help: 'Any feature layer or table.', geom: [...ANY_GEOM, 'Table'] }),
    fieldsP('fields', 'Compare fields', 'input', { help: 'Features are identical when all of these fields match. Empty compares geometry only.' }),
    boolP('geometry', 'Compare geometry', true, { help: 'Also require identical shape and location.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const names: string[] = (ctx.params.fields ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
    const useGeom = !!ctx.params.geometry;
    if (!names.length && !useGeom) throw new ToolError('Pick at least one field or turn on "Compare geometry".');
    const seen = new Set<string>();
    const out: GpFeature[] = [];
    for (const f of input.features) {
      const key = JSON.stringify(names.map((n) => f.properties[n] ?? null)) + (useGeom ? geomKey(f.geometry) : '');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mkFeature(f.geometry, { ...f.properties }, f.id));
    }
    ctx.message(`${(input.features.length - out.length).toLocaleString()} identical features removed; ${out.length.toLocaleString()} kept.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Select ----------

export const select: ToolDef = {
  id: 'select',
  name: 'Select',
  category: CAT,
  description: 'Extracts the features that satisfy a where clause into a new layer, e.g. POP > 1000000 AND NAME LIKE \'A%\'. With an empty clause every feature is copied.',
  keywords: ['extract', 'filter', 'query', 'where', 'subset', 'attribute'],
  params: [
    layerP('input', 'Input features', { help: 'Any feature layer or table.', geom: [...ANY_GEOM, 'Table'] }),
    whereP('where', 'Expression', 'input', { help: 'A where clause using the Terrane expression language. Field names can be typed directly or written as [Field Name].' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const src = String(ctx.params.where ?? '').trim();
    let test: (f: any) => boolean;
    try {
      test = compileWhere(src);
    } catch (e: any) {
      throw new ToolError(`Invalid expression: ${e?.message ?? e}`);
    }
    if (!src) ctx.message('No expression was given, so all features were copied.', 'warning');
    const out = input.features.filter((f) => test({ id: f.id, properties: f.properties, geometry: f.geometry })).map((f) => mkFeature(f.geometry, { ...f.properties }, f.id));
    ctx.message(`${out.length.toLocaleString()} of ${input.features.length.toLocaleString()} features selected.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Calculate Geometry Attributes ----------

const VERT = (g: Geometry | null) => coordsOf(g).length;

export const calculateGeometry: ToolDef = {
  id: 'calculate-geometry-attributes',
  name: 'Calculate Geometry Attributes',
  category: CAT,
  description:
    'Writes geometric measurements into fields of a new copy of the layer: geodesic area, perimeter, length, centroid coordinates, vertex and part counts. Fields that already exist are overwritten in the copy.',
  keywords: ['area', 'length', 'perimeter', 'centroid', 'x', 'y', 'vertices', 'measure', 'field calculator'],
  outputPrefix: 'Geometry',
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }),
    multiP('props', 'Attributes', ['AREA'], [
      ['AREA', 'Area'], ['PERIMETER', 'Perimeter (polygons)'], ['LENGTH', 'Length (lines)'], ['CENTROID_X', 'Centroid X (longitude)'],
      ['CENTROID_Y', 'Centroid Y (latitude)'], ['VERTEX_COUNT', 'Vertex count'], ['PART_COUNT', 'Part count'],
    ], { help: 'Which measurements to add. Measurements that do not apply to the geometry type are skipped.' }),
    choiceP('areaUnit', 'Area unit', 'km2', AREA_UNITS, { help: 'Unit for area values.' }),
    choiceP('lengthUnit', 'Length unit', 'km', LENGTH_UNITS, { help: 'Unit for length and perimeter values.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const want = new Set<string>(ctx.params.props ?? []);
    if (!want.size) throw new ToolError('Choose at least one attribute to calculate.');
    const au = String(ctx.params.areaUnit), lu = String(ctx.params.lengthUnit);
    const fam = input.geomType;
    const cols: Array<{ f: Field; calc: (g: Geometry) => number | null }> = [];
    const add = (key: string, name: string, type: Field['type'], calc: (g: Geometry) => number | null, applies = true) => {
      if (!want.has(key)) return;
      if (!applies) return void ctx.message(`${key.toLowerCase().replace('_', ' ')} does not apply to ${fam?.toLowerCase()} features and was skipped.`, 'warning');
      cols.push({ f: { name, type }, calc });
    };
    add('AREA', `Area_${au}`, 'number', (g) => geomAreaM2(g) / AREA_M2[au], fam === 'Polygon');
    add('PERIMETER', `Perimeter_${lu}`, 'number', (g) => geomPerimeterM(g) / LENGTH_M[lu], fam === 'Polygon');
    add('LENGTH', `Length_${lu}`, 'number', (g) => geomLengthM(g) / LENGTH_M[lu], fam === 'LineString');
    add('CENTROID_X', 'Centroid_X', 'number', (g) => centroidOf(g)?.[0] ?? null);
    add('CENTROID_Y', 'Centroid_Y', 'number', (g) => centroidOf(g)?.[1] ?? null);
    add('VERTEX_COUNT', 'Vertex_Count', 'integer', (g) => VERT(g));
    add('PART_COUNT', 'Part_Count', 'integer', (g) => (fam === 'Polygon' ? polygonsOf(g).length : fam === 'LineString' ? linesOf(g).length : pointsOf(g).length));
    if (!cols.length) throw new ToolError('None of the chosen attributes apply to this layer.');
    const out = input.features.map((f) => {
      const props = { ...f.properties };
      for (const c of cols) props[c.f.name] = f.geometry ? c.calc(f.geometry) : null;
      return mkFeature(f.geometry, props, f.id);
    });
    const fields = input.fields.map((f) => cols.find((c) => c.f.name === f.name)?.f ?? f);
    for (const c of cols) if (!fields.some((f) => f.name === c.f.name)) fields.push(c.f);
    ctx.message(`Calculated ${cols.map((c) => c.f.name).join(', ')} for ${out.length.toLocaleString()} features.`);
    return buildResult(out, { geomType: input.geomType, fields });
  },
};

export const FEATURE_TOOLS: ToolDef[] = [
  select, featureToPoint, verticesToPoints, polygonToLine, featureToPolygon, pointsToLine, minimumBoundingGeometry, multipartToSinglepart, deleteIdentical, calculateGeometry,
];
