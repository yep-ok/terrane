// Proximity tools: Buffer, Multiple Ring Buffer, Near, Create Thiessen Polygons.
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import {
  buildResult, coordsOf, differencePolys, groupBy, fieldsOfNames, mkFeature, nearestItem, polygonsOf, toMeters, uniqueName, unionPolys,
  layerBBox, pointsOf, type BBox,
} from '../geo';
import { ANY_GEOM, POINT, UNIT_OPTIONS, boolP, choiceP, distP, fieldP, fieldsP, layerP, numP, outP, strP } from '../params';
import { ToolError, type Field, type GpFeature, type ToolDef } from '../types';
import { indexLayer, ticker, warnIfSkipped } from './common';

const CAT = 'Proximity';

export function bufferGeom(g: Geometry, meters: number, steps: number): Geometry | null {
  if (!coordsOf(g).length) return null;
  try {
    const r: any = turf.buffer({ type: 'Feature', properties: {}, geometry: g } as any, meters / 1000, { units: 'kilometers', steps });
    return r?.geometry && polygonsOf(r.geometry as Geometry).length ? (r.geometry as Geometry) : null;
  } catch {
    return null;
  }
}

const UNIT_M: Record<string, number> = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };

export const buffer: ToolDef = {
  id: 'buffer',
  name: 'Buffer',
  category: CAT,
  description:
    'Creates polygons around the input features at a given distance (or a distance taken from a field). Distances are geodesic. Optionally dissolves overlapping buffers, either all together or per group of field values.',
  keywords: ['distance', 'around', 'proximity', 'radius', 'zone'],
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons to buffer.', geom: ANY_GEOM }),
    choiceP('mode', 'Distance from', 'distance', [['distance', 'Fixed distance'], ['field', 'Field value']], { help: 'Use one distance for every feature, or read it from a numeric field.' }),
    distP('distance', 'Distance', { value: 1, unit: 'km' }, { help: 'Buffer distance. Negative values shrink polygons.', showIf: (v) => v.mode !== 'field' }),
    fieldP('field', 'Distance field', 'input', { help: 'Numeric field holding the buffer distance for each feature.', types: ['number', 'integer'], showIf: (v) => v.mode === 'field' }),
    choiceP('fieldUnit', 'Field units', 'm', UNIT_OPTIONS, { help: 'Units of the values in the distance field.', showIf: (v) => v.mode === 'field' }),
    numP('steps', 'Segments per quarter', 12, { help: 'Number of straight segments used to approximate a quarter circle. Higher is smoother but larger.', min: 1, max: 64, integer: true }),
    boolP('dissolve', 'Dissolve results', false, { help: 'Merge overlapping buffers into single features.' }),
    fieldsP('dissolveFields', 'Dissolve fields', 'input', { help: 'When dissolving, only buffers with identical values in these fields are merged. Empty merges all.', showIf: (v) => !!v.dissolve }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const p = ctx.params;
    const steps = Math.max(1, Math.min(64, Math.round(Number(p.steps) || 12)));
    const fixed = toMeters(p.distance);
    const fieldMode = p.mode === 'field' && p.field;
    const unitM = UNIT_M[String(p.fieldUnit)] ?? 1;
    const distName = uniqueName('Buffer_Dist_m', input.fields.map((f) => f.name));
    const tick = ticker(ctx, input.features.length, 'Buffering feature');
    const made: Array<{ f: GpFeature; g: Geometry; d: number }> = [];
    let skipped = 0;
    input.features.forEach((f, i) => {
      tick(i);
      if (!f.geometry) return void skipped++;
      const raw = fieldMode ? Number(f.properties[p.field]) * unitM : fixed;
      if (!Number.isFinite(raw) || (f.properties[p.field] == null && fieldMode)) return void skipped++;
      if (raw === 0 || (raw < 0 && input.geomType !== 'Polygon')) return void skipped++;
      const g = bufferGeom(f.geometry, raw, steps);
      if (g) made.push({ f, g, d: raw });
      else skipped++;
    });
    warnIfSkipped(ctx, skipped, 'features had no geometry, an invalid distance, or an empty buffer and were');
    let out: GpFeature[];
    if (p.dissolve) {
      const names = (p.dissolveFields ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
      const groups = groupBy(made.map((m) => m.f), names);
      const byFeature = new Map(made.map((m) => [m.f, m]));
      out = [];
      for (const rows of groups.values()) {
        const u = unionPolys(rows.map((r) => byFeature.get(r)!.g));
        if (!u) continue;
        const props: Record<string, any> = {};
        for (const n of names) props[n] = rows[0].properties[n] ?? null;
        const dists = new Set(rows.map((r) => byFeature.get(r)!.d));
        props[distName] = dists.size === 1 ? [...dists][0] : null;
        out.push(mkFeature(u, props));
      }
      ctx.message(`${made.length.toLocaleString()} buffers dissolved into ${out.length.toLocaleString()} features.`);
      return buildResult(out, { geomType: 'Polygon', fields: [...fieldsOfNames(input, names), { name: distName, type: 'number' }] });
    }
    out = made.map((m) => mkFeature(m.g, { ...m.f.properties, [distName]: m.d }, m.f.id));
    return buildResult(out, { geomType: 'Polygon', fields: [...input.fields, { name: distName, type: 'number' }] });
  },
};

// ---------- Multiple Ring Buffer ----------

export const multiRingBuffer: ToolDef = {
  id: 'multiple-ring-buffer',
  name: 'Multiple Ring Buffer',
  category: CAT,
  description:
    'Creates buffers at several distances around the input features. With "Non-overlapping rings" each output polygon covers only the band between two distances (a donut); otherwise each polygon is a full buffer.',
  keywords: ['rings', 'concentric', 'distances', 'bands', 'donut'],
  outputPrefix: 'RingBuffer',
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }),
    strP('distances', 'Distances', '1, 2, 5', { help: 'Comma-separated list of distances, e.g. 100, 250, 500.', placeholder: '1, 2, 5' }),
    choiceP('unit', 'Distance unit', 'km', UNIT_OPTIONS, { help: 'Unit of every distance in the list.' }),
    boolP('rings', 'Non-overlapping rings', true, { help: 'Output donut-shaped bands instead of overlapping full buffers.' }),
    boolP('dissolve', 'Dissolve across features', true, { help: 'Merge the buffers of all input features at each distance. When off, each input feature gets its own rings.' }),
    numP('steps', 'Segments per quarter', 8, { help: 'Number of segments used to approximate a quarter circle.', min: 1, max: 64, integer: true }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const unit = UNIT_M[String(ctx.params.unit)] ?? 1;
    const dists = [...new Set(String(ctx.params.distances).split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b);
    if (!dists.length) throw new ToolError('Enter at least one positive distance, e.g. "100, 250, 500".');
    const steps = Math.max(1, Math.round(Number(ctx.params.steps) || 8));
    const feats = input.features.filter((f) => f.geometry && coordsOf(f.geometry).length);
    const out: GpFeature[] = [];
    const total = dists.length * (ctx.params.dissolve ? 1 : feats.length);
    let n = 0;
    const tick = ticker(ctx, total, 'Ring');
    const mk = (g: Geometry, d: number, from: number, f?: GpFeature) =>
      mkFeature(g, { ...(f ? f.properties : {}), Ring_Distance: d, Ring_From: from, Ring_Unit: String(ctx.params.unit) });
    if (ctx.params.dissolve) {
      let prev: Geometry | null = null;
      let prevD = 0;
      for (const d of dists) {
        tick(n++);
        const u = unionPolys(feats.map((f) => bufferGeom(f.geometry!, d * unit, steps)).filter(Boolean) as Geometry[]);
        if (!u) continue;
        const g: Geometry | null = ctx.params.rings && prev ? differencePolys(u, [prev]) : u;
        if (g && polygonsOf(g).length) out.push(mk(g, d, ctx.params.rings ? prevD : 0));
        prev = u;
        prevD = d;
      }
      return buildResult(out, { geomType: 'Polygon', fields: ringFields([]) });
    }
    for (const f of feats) {
      let prev: Geometry | null = null;
      let prevD = 0;
      for (const d of dists) {
        tick(n++);
        const b = bufferGeom(f.geometry!, d * unit, steps);
        if (!b) continue;
        const g: Geometry | null = ctx.params.rings && prev ? differencePolys(b, [prev]) : b;
        if (g && polygonsOf(g).length) out.push(mk(g, d, ctx.params.rings ? prevD : 0, f));
        prev = b;
        prevD = d;
      }
    }
    return buildResult(out, { geomType: 'Polygon', fields: ringFields(input.fields) });
  },
};
const ringFields = (src: Field[]): Field[] => [
  ...src,
  { name: 'Ring_Distance', type: 'number' },
  { name: 'Ring_From', type: 'number' },
  { name: 'Ring_Unit', type: 'string' },
];

// ---------- Near ----------

export const near: ToolDef = {
  id: 'near',
  name: 'Near',
  category: CAT,
  description:
    'Finds the closest feature in a second layer for every input feature and writes its FID (NEAR_FID) and the geodesic distance in meters (NEAR_DIST). Features with no neighbour inside the search distance get empty values. A new layer is created; the input is not modified.',
  keywords: ['nearest', 'closest', 'distance', 'neighbor'],
  params: [
    layerP('input', 'Input features', { help: 'Features that get the Near attributes.', geom: ANY_GEOM }),
    layerP('near', 'Near features', { help: 'Features to search for the nearest neighbour.', geom: ANY_GEOM }),
    distP('radius', 'Search distance', { value: 0, unit: 'km' }, { help: 'Ignore neighbours farther away than this. 0 means no limit.', min: 0 }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input'), nearL = ctx.layer('near');
    const radius = toMeters(ctx.params.radius);
    const { boxes, index } = indexLayer(nearL.features);
    const items = nearL.features.map((f, i) => ({ geom: f.geometry, box: boxes[i] }));
    const taken = input.fields.map((f) => f.name);
    const fidName = uniqueName('NEAR_FID', taken);
    const distName = uniqueName('NEAR_DIST', [...taken, fidName]);
    const tick = ticker(ctx, input.features.length, 'Measuring feature');
    let found = 0;
    const out = input.features.map((f, i) => {
      tick(i);
      const hit = f.geometry ? nearestItem(f.geometry, items, index, radius) : null;
      if (hit) found++;
      return mkFeature(f.geometry, { ...f.properties, [fidName]: hit ? nearL.features[hit.i].id ?? hit.i + 1 : null, [distName]: hit ? hit.d : null }, f.id);
    });
    ctx.message(`${found.toLocaleString()} of ${out.length.toLocaleString()} features have a neighbour${radius ? ' within the search distance' : ''}.`);
    return buildResult(out, {
      geomType: input.geomType,
      fields: [...input.fields, { name: fidName, type: 'integer' }, { name: distName, type: 'number' }],
    });
  },
};

// ---------- Thiessen ----------

export const thiessen: ToolDef = {
  id: 'create-thiessen-polygons',
  name: 'Create Thiessen Polygons',
  category: CAT,
  description:
    'Builds proximal (Voronoi) polygons: every location inside a polygon is closer to its point than to any other point. Cells are limited to the point extent grown by the chosen margin. Duplicate points are ignored. Computed in lon/lat space.',
  keywords: ['voronoi', 'proximal', 'catchment', 'nearest region', 'service area'],
  outputPrefix: 'Thiessen',
  params: [
    layerP('input', 'Input points', { help: 'Point features (at least three distinct locations).', geom: POINT }),
    numP('margin', 'Extent margin (%)', 25, { help: 'How far outside the points\' extent the outer cells reach, as a percentage of the extent size.', min: 0, max: 500 }),
    boolP('attributes', 'Copy point attributes', true, { help: 'When off, only an ID field is written.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const seen = new Set<string>();
    const pts: Array<{ f: GpFeature; c: number[] }> = [];
    for (const f of input.features) {
      const c = pointsOf(f.geometry)[0];
      if (!c) continue;
      const k = `${c[0]},${c[1]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pts.push({ f, c });
    }
    if (pts.length < 3) throw new ToolError('At least three distinct points are needed to create Thiessen polygons.');
    if (pts.length < input.features.length) ctx.message(`${input.features.length - pts.length} duplicate or empty points were ignored.`, 'warning');
    const b = layerBBox({ ...input, features: pts.map((p) => p.f) }) as BBox;
    const mx = Math.max((b[2] - b[0]) * (Number(ctx.params.margin) / 100), 1e-4), my = Math.max((b[3] - b[1]) * (Number(ctx.params.margin) / 100), 1e-4);
    const box: BBox = [Math.max(-180, b[0] - mx), Math.max(-90, b[1] - my), Math.min(180, b[2] + mx), Math.min(90, b[3] + my)];
    const fc = turf.featureCollection(pts.map((p, i) => turf.point(p.c, { i })));
    const cells = turf.voronoi(fc, { bbox: box });
    const out: GpFeature[] = [];
    cells.features.forEach((cell, i) => {
      if (!cell || !cell.geometry) return;
      const src = pts[i].f;
      out.push(mkFeature(cell.geometry as Geometry, ctx.params.attributes ? { ...src.properties } : { Input_FID: src.id ?? i + 1 }));
    });
    ctx.message(`${out.length.toLocaleString()} Thiessen polygons created.`);
    return buildResult(out, { geomType: 'Polygon', fields: ctx.params.attributes ? input.fields : [{ name: 'Input_FID', type: 'integer' }] });
  },
};

export const PROXIMITY_TOOLS: ToolDef[] = [buffer, multiRingBuffer, near, thiessen];
