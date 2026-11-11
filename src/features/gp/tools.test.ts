import { describe, expect, it, vi } from 'vitest';
import * as turf from '@turf/turf';

// The real expression engine is owned by another module; use a tiny stand-in here.
vi.mock('../../core/expr', () => ({
  compileWhere: (src: string) => {
    const s = src.trim();
    if (!s) return () => true;
    const m = /^(\w+)\s*(>|<|=)\s*(\d+)$/.exec(s);
    if (!m) throw new Error('Syntax error');
    const n = Number(m[3]);
    return (f: any) => {
      const v = Number(f.properties?.[m[1]]);
      return m[2] === '>' ? v > n : m[2] === '<' ? v < n : v === n;
    };
  },
}));

import { ALL_TOOLS, getTool } from './tools';
import { runToolById } from './exec';
import { inferType } from './geo';
import type { Field, GeomType, GpFeature, LayerData, ToolResult } from './types';

// ---------- fixtures ----------

const poly = (x0: number, y0: number, x1: number, y1: number): any => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
const F = (geometry: any, properties: Record<string, any> = {}, id?: number): GpFeature => ({ type: 'Feature', id, geometry, properties });
function layer(name: string, geomType: GeomType | null, features: GpFeature[]): LayerData {
  const names: string[] = [];
  for (const f of features) for (const k in f.properties) if (!names.includes(k)) names.push(k);
  const fields: Field[] = names.map((n) => ({ name: n, type: inferType(features.map((f) => f.properties[n])) }));
  return { name, geomType, fields, features: features.map((f, i) => ({ ...f, id: f.id ?? i + 1 })) };
}
const area = (g: any) => turf.area({ type: 'Feature', properties: {}, geometry: g });
const sumArea = (r: ToolResult) => r.features.reduce((s, f) => s + (f.geometry ? area(f.geometry) : 0), 0);

const A = poly(0, 0, 0.2, 0.2);
const B = poly(0.1, 0.1, 0.3, 0.3);
const multi: any = { type: 'MultiPolygon', coordinates: [poly(0.5, 0, 0.6, 0.1).coordinates, poly(0.8, 0, 0.9, 0.1).coordinates] };

const polysA = () => layer('A', 'Polygon', [F(A, { name: 'a', pop: 10, grp: 'x' }), F(multi, { name: 'm', pop: 30, grp: 'x' }), F(null, { name: 'none', pop: 5, grp: 'y' })]);
const polysB = () => layer('B', 'Polygon', [F(B, { code: 'b', rank: 2 })]);
const pts = () => {
  const f: GpFeature[] = [];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) f.push(F({ type: 'Point', coordinates: [0.02 + i * 0.07, 0.02 + j * 0.07] }, { v: i * 4 + j, cat: i % 2 ? 'odd' : 'even', t: j }));
  f.push(F({ type: 'MultiPoint', coordinates: [[0.05, 0.05], [0.25, 0.25]] }, { v: 100, cat: 'odd', t: 9 }));
  f.push(F(null, { v: 1, cat: 'even', t: 0 }));
  return layer('Pts', 'Point', f);
};
const lines = () =>
  layer('Lines', 'LineString', [
    F({ type: 'LineString', coordinates: [[-0.1, 0.1], [0.4, 0.1]] }, { id: 1, kind: 'road' }),
    F({ type: 'MultiLineString', coordinates: [[[0.1, -0.1], [0.1, 0.4]], [[0.2, -0.1], [0.2, 0.4]]] }, { id: 2, kind: 'rail' }),
    F(null, { id: 3, kind: 'none' }),
  ]);
const table = () =>
  layer('T', null, [
    F(null, { ox: 0, oy: 0, dx: 10, dy: 10, brg: 90, d: 5, g: 'a' }),
    F(null, { ox: 10, oy: 10, dx: -20, dy: 40, brg: 180, d: 2, g: 'b' }),
    F(null, { ox: 1, oy: 1, dx: 2, dy: 1, brg: 0, d: 1, g: 'a' }),
  ]);
const run = (id: string, inputs: Record<string, LayerData | LayerData[]>, params: Record<string, any> = {}) => {
  const msgs: string[] = [];
  const norm: Record<string, LayerData[]> = {};
  for (const k in inputs) norm[k] = Array.isArray(inputs[k]) ? (inputs[k] as LayerData[]) : [inputs[k] as LayerData];
  const result = runToolById(id, norm, params, { message: (t) => msgs.push(t) });
  return { result, msgs, props: (name: string) => result.features.map((f) => f.properties[name]) };
};

// ---------- core overlay tools ----------

describe('buffer', () => {
  it('buffers a point at the requested geodesic distance', () => {
    const { result } = run('buffer', { input: layer('p', 'Point', [F({ type: 'Point', coordinates: [10, 45] }, { n: 1 })]) }, { distance: { value: 2, unit: 'km' } });
    expect(result.geomType).toBe('Polygon');
    expect(result.features).toHaveLength(1);
    const km2 = area(result.features[0].geometry) / 1e6;
    expect(km2).toBeGreaterThan(Math.PI * 4 * 0.98);
    expect(km2).toBeLessThan(Math.PI * 4 * 1.02);
    expect(result.features[0].properties.n).toBe(1);
    expect(result.features[0].properties.Buffer_Dist_m).toBe(2000);
  });
  it('dissolves overlapping buffers and supports a distance field with units', () => {
    const p = layer('p', 'Point', [F({ type: 'Point', coordinates: [0, 0] }, { d: 1 }), F({ type: 'Point', coordinates: [0.01, 0] }, { d: 2 }), F(null, { d: 3 })]);
    const d = run('buffer', { input: p }, { distance: { value: 1, unit: 'km' }, dissolve: true });
    expect(d.result.features).toHaveLength(1);
    const f = run('buffer', { input: p }, { mode: 'field', field: 'd', fieldUnit: 'km' });
    expect(f.result.features).toHaveLength(2);
    expect(area(f.result.features[1].geometry)).toBeGreaterThan(area(f.result.features[0].geometry) * 3.5);
    expect(f.msgs.some((m) => /skipped/.test(m))).toBe(true);
  });
  it('handles multipart lines and polygons', () => {
    expect(run('buffer', { input: lines() }, { distance: { value: 1, unit: 'km' } }).result.features).toHaveLength(2);
    expect(run('buffer', { input: polysA() }, { distance: { value: 1, unit: 'km' } }).result.features).toHaveLength(2);
  });
});

describe('multiple ring buffer', () => {
  it('creates non-overlapping rings whose areas add up to the largest buffer', () => {
    const p = layer('p', 'Point', [F({ type: 'Point', coordinates: [0, 0] })]);
    const r = run('multiple-ring-buffer', { input: p }, { distances: '1, 2, 3', unit: 'km' }).result;
    expect(r.features.map((f) => f.properties.Ring_Distance)).toEqual([1, 2, 3]);
    const big = run('buffer', { input: p }, { distance: { value: 3, unit: 'km' }, steps: 8 }).result;
    expect(sumArea(r) / area(big.features[0].geometry)).toBeCloseTo(1, 1);
  });
});

describe('clip / intersect / erase / union / symmetrical difference', () => {
  it('clip trims polygons, keeps attributes and ignores null geometry', () => {
    const r = run('clip', { input: polysA(), clip: polysB() }).result;
    expect(r.features).toHaveLength(1);
    expect(r.features[0].properties.name).toBe('a');
    expect(area(r.features[0].geometry) / area(A)).toBeCloseTo(0.25, 2);
  });
  it('clip cuts lines and keeps points inside', () => {
    const l = run('clip', { input: lines(), clip: polysA() }).result;
    expect(l.geomType).toBe('LineString');
    // horizontal line y=0.1 crosses A from x=0..0.2; vertical lines x=0.1, 0.2 (edge)
    const len = l.features.reduce((s, f) => s + turf.length(f as any, { units: 'kilometers' }), 0);
    expect(len).toBeGreaterThan(0.2 * 111 * 0.95);
    const p = run('clip', { input: pts(), clip: polysB() }).result;
    expect(p.features.length).toBeGreaterThan(0);
    for (const f of p.features) for (const c of turf.coordAll(f as any)) expect(c[0] >= 0.1 && c[1] >= 0.1).toBe(true);
  });
  it('intersect keeps both attribute sets and the overlapping area', () => {
    const r = run('intersect', { input: polysA(), overlay: polysB() }).result;
    expect(r.features).toHaveLength(1);
    expect(r.features[0].properties).toMatchObject({ name: 'a', pop: 10, code: 'b', rank: 2 });
    expect(area(r.features[0].geometry) / area(A)).toBeCloseTo(0.25, 2);
    expect(r.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'code', 'rank']));
  });
  it('intersect of lines and polygons returns lines with both attributes', () => {
    const r = run('intersect', { input: lines(), overlay: polysA() }).result;
    expect(r.geomType).toBe('LineString');
    expect(r.features[0].properties.kind).toBeDefined();
    expect(r.features[0].properties.name).toBeDefined();
  });
  it('erase removes the overlap', () => {
    const r = run('erase', { input: polysA(), erase: polysB() }).result;
    const a = r.features.find((f) => f.properties.name === 'a')!;
    expect(area(a.geometry) / area(A)).toBeCloseTo(0.75, 2);
    expect(r.features.find((f) => f.properties.name === 'm')).toBeDefined();
  });
  it('union partitions both layers; areas add up', () => {
    const r = run('union', { input: polysA(), overlay: polysB() }).result;
    const expected = area(A) + area(B) - area(A) * 0.25 + area(multi);
    expect(sumArea(r) / expected).toBeCloseTo(1, 2);
    const both = r.features.filter((f) => f.properties.name === 'a' && f.properties.code === 'b');
    expect(both).toHaveLength(1);
    expect(r.features.some((f) => f.properties.name == null && f.properties.code === 'b')).toBe(true);
  });
  it('symmetrical difference excludes the intersection', () => {
    const r = run('symmetrical-difference', { input: polysA(), overlay: polysB() }).result;
    expect(r.features.find((f) => f.properties.name === 'a' && f.properties.code === 'b')).toBeUndefined();
    const aOnly = r.features.filter((f) => f.properties.name === 'a');
    expect(area(aOnly[0].geometry) / area(A)).toBeCloseTo(0.75, 2);
  });
});

describe('dissolve / merge', () => {
  it('dissolves by field with statistics', () => {
    const r = run('dissolve', { input: polysA() }, { fields: ['grp'], stats: [{ field: 'pop', stat: 'sum' }, { field: 'pop', stat: 'mean' }] }).result;
    expect(r.features).toHaveLength(1); // the 'y' group only has a null geometry and is dropped
    const x = r.features.find((f) => f.properties.grp === 'x')!;
    expect(x.properties.SUM_pop).toBe(40);
    expect(x.properties.MEAN_pop).toBe(20);
    expect(r.fields.map((f) => f.name)).toEqual(['grp', 'SUM_pop', 'MEAN_pop']);
  });
  it('dissolves touching polygons into one', () => {
    const l = layer('s', 'Polygon', [F(poly(0, 0, 1, 1)), F(poly(1, 0, 2, 1)), F(poly(2, 0, 3, 1))]);
    const r = run('dissolve', { input: l }).result;
    expect(r.features).toHaveLength(1);
    expect(r.features[0].geometry!.type).toBe('Polygon');
  });
  it('merge appends layers and unions fields', () => {
    const r = run('merge', { inputs: [polysA(), polysB()] }, { source: true }).result;
    expect(r.features).toHaveLength(4);
    expect(r.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['name', 'code', 'Source_Layer']));
    expect(r.features[3].properties.Source_Layer).toBe('B');
  });
});

describe('spatial join / summarize within', () => {
  const zones = () => layer('Z', 'Polygon', [F(poly(0, 0, 0.15, 0.15), { zone: 'sw' }), F(poly(0.15, 0.15, 0.3, 0.3), { zone: 'ne' }), F(poly(5, 5, 6, 6), { zone: 'far' })]);
  it('counts and sums points per zone', () => {
    const r = run('spatial-join', { target: zones(), join: pts() }, { field: 'v', stat: 'sum', copy: false }).result;
    const byZone = Object.fromEntries(r.features.map((f) => [f.properties.zone, f.properties]));
    expect(byZone.far.Join_Count).toBe(0);
    expect(byZone.sw.Join_Count + byZone.ne.Join_Count).toBeGreaterThan(5);
    expect(byZone.sw.SUM_v).toBeGreaterThan(0);
    expect(r.features).toHaveLength(3);
  });
  it('supports within / contains / closest', () => {
    const w = run('spatial-join', { target: pts(), join: zones() }, { match: 'within', copy: true }).result;
    expect(w.features.filter((f) => f.properties.Join_Count > 0).length).toBeGreaterThan(5);
    expect(w.features[0].properties.zone).toBe('sw');
    const c = run('spatial-join', { target: zones(), join: pts() }, { match: 'contains', copy: false }).result;
    expect(c.features[0].properties.Join_Count).toBeGreaterThan(0);
    const n = run('spatial-join', { target: zones(), join: pts() }, { match: 'closest', distance: { value: 1000, unit: 'km' }, copy: false }).result;
    expect(n.features.every((f) => f.properties.Join_Count === 1)).toBe(true);
    expect(n.features[2].properties.Join_Distance_m).toBeGreaterThan(100000);
    const none = run('spatial-join', { target: zones(), join: pts() }, { match: 'closest', distance: { value: 1, unit: 'km' }, copy: false }).result;
    expect(none.features[2].properties.Join_Count).toBe(0);
  });
  it('summarize within matches the spatial join counts', () => {
    const r = run('summarize-within', { polygons: zones(), points: pts() }, { stats: [{ field: 'v', stat: 'sum' }, { field: 'v', stat: 'mean' }] }).result;
    const j = run('spatial-join', { target: zones(), join: pts() }, { copy: false }).result;
    expect(r.features.map((f) => f.properties.Point_Count)).toEqual(j.features.map((f) => f.properties.Join_Count));
    expect(r.features[0].properties.SUM_v).toBeGreaterThan(0);
    expect(r.features[2].properties.Point_Count).toBe(0);
  });
});

describe('count overlapping / tabulate', () => {
  it('finds the doubly covered piece', () => {
    const l = layer('o', 'Polygon', [F(A), F(B)]);
    const r = run('count-overlapping', { input: l }).result;
    const two = r.features.filter((f) => f.properties.Overlap_Count === 2);
    expect(two).toHaveLength(1);
    expect(area(two[0].geometry) / area(A)).toBeCloseTo(0.25, 2);
    expect(sumArea(r) / (area(A) * 1.75)).toBeCloseTo(1, 2);
    expect(run('count-overlapping', { input: l }, { minCount: 2 }).result.features).toHaveLength(1);
  });
  it('tabulates area by class per zone', () => {
    const zones = layer('Z', 'Polygon', [F(poly(0, 0, 0.2, 0.2), { name: 'z1' })]);
    const classes = layer('C', 'Polygon', [F(poly(0, 0, 0.1, 0.2), { lc: 'forest' }), F(poly(0.1, 0, 0.2, 0.1), { lc: 'water' })]);
    const r = run('tabulate-intersection', { zones, classes }, { zoneField: 'name', classField: 'lc' }).result;
    expect(r.geomType).toBeNull();
    const forest = r.features.find((f) => f.properties.Class === 'forest')!;
    expect(forest.properties.Zone).toBe('z1');
    expect(forest.properties.Percent).toBeCloseTo(50, 0);
    expect(r.features.find((f) => f.properties.Class === 'water')!.properties.Percent).toBeCloseTo(25, 0);
  });
});

// ---------- proximity ----------

describe('near / thiessen', () => {
  it('reports nearest FID and distance', () => {
    const a = layer('a', 'Point', [F({ type: 'Point', coordinates: [0, 0] }), F({ type: 'Point', coordinates: [1, 0] })]);
    const b = layer('b', 'Point', [F({ type: 'Point', coordinates: [0.01, 0] }, {}, 7), F({ type: 'Point', coordinates: [1, 0.5] }, {}, 8)]);
    const r = run('near', { input: a, near: b }).result;
    expect(r.features[0].properties.NEAR_FID).toBe(7);
    expect(r.features[0].properties.NEAR_DIST).toBeCloseTo(1111.95, 0);
    expect(r.features[1].properties.NEAR_FID).toBe(8);
    const lim = run('near', { input: a, near: b }, { radius: { value: 10, unit: 'm' } }).result;
    expect(lim.features[0].properties.NEAR_FID).toBeNull();
  });
  it('creates one thiessen polygon per distinct point', () => {
    const r = run('create-thiessen-polygons', { input: pts() }).result;
    expect(r.geomType).toBe('Polygon');
    expect(r.features.length).toBeGreaterThanOrEqual(16);
    expect(r.features[0].properties.v).toBeDefined();
  });
});

// ---------- features ----------

describe('feature conversion tools', () => {
  it('feature to point inside stays within a C-shaped polygon', () => {
    const c: any = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 1], [1, 1], [1, 2], [3, 2], [3, 3], [0, 3], [0, 0]]] };
    const l = layer('c', 'Polygon', [F(c, { k: 1 })]);
    const r = run('feature-to-point', { input: l }, { method: 'inside' }).result;
    expect(turf.booleanPointInPolygon(r.features[0].geometry as any, c)).toBe(true);
    expect(r.features[0].properties.k).toBe(1);
    const cen = run('feature-to-point', { input: polysA() }).result;
    expect(cen.features).toHaveLength(2);
    expect(cen.features[0].geometry).toMatchObject({ type: 'Point' });
    expect((cen.features[0].geometry as any).coordinates[0]).toBeCloseTo(0.1, 6);
  });
  it('vertices to points', () => {
    expect(run('feature-vertices-to-points', { input: polysA() }).result.features).toHaveLength(4 + 8);
    expect(run('feature-vertices-to-points', { input: lines() }, { which: 'ends' }).result.features).toHaveLength(2 + 4);
    const mid = run('feature-vertices-to-points', { input: lines() }, { which: 'mid' }).result;
    expect((mid.features[0].geometry as any).coordinates[0]).toBeCloseTo(0.15, 3);
  });
  it('polygon to line keeps boundaries', () => {
    const r = run('polygon-to-line', { input: polysA() }).result;
    expect(r.geomType).toBe('LineString');
    expect(r.features).toHaveLength(2);
  });
  it('feature to polygon builds the enclosed area from crossing lines', () => {
    const l = layer('hash', 'LineString', [
      F({ type: 'LineString', coordinates: [[0, 1], [4, 1]] }), F({ type: 'LineString', coordinates: [[0, 3], [4, 3]] }),
      F({ type: 'LineString', coordinates: [[1, 0], [1, 4]] }), F({ type: 'LineString', coordinates: [[3, 0], [3, 4]] }),
    ]);
    const r = run('feature-to-polygon', { input: l }).result;
    expect(r.features).toHaveLength(1);
    expect(area(r.features[0].geometry) / area(poly(1, 1, 3, 3))).toBeCloseTo(1, 2);
  });
  it('points to line groups and sorts', () => {
    const p = layer('p', 'Point', [
      F({ type: 'Point', coordinates: [2, 0] }, { g: 'a', o: 2 }), F({ type: 'Point', coordinates: [0, 0] }, { g: 'a', o: 0 }),
      F({ type: 'Point', coordinates: [1, 0] }, { g: 'a', o: 1 }), F({ type: 'Point', coordinates: [5, 5] }, { g: 'b', o: 0 }),
    ]);
    const r = run('points-to-line', { input: p }, { group: ['g'], sort: 'o' }).result;
    expect(r.features).toHaveLength(1);
    expect((r.features[0].geometry as any).coordinates.map((c: number[]) => c[0])).toEqual([0, 1, 2]);
    expect(r.features[0].properties.Point_Count).toBe(3);
  });
  it('minimum bounding geometry: hull, envelope and circle', () => {
    const hull = run('minimum-bounding-geometry', { input: pts() }).result;
    expect(hull.features).toHaveLength(1);
    expect(hull.features[0].properties.Feature_Count).toBe(17);
    const env = run('minimum-bounding-geometry', { input: pts() }, { kind: 'envelope' }).result;
    expect(area(env.features[0].geometry)).toBeGreaterThan(area(hull.features[0].geometry) * 0.99);
    const circ = run('minimum-bounding-geometry', { input: pts() }, { kind: 'circle' }).result;
    expect(circ.features[0].properties.Radius_m).toBeGreaterThan(0);
    for (const f of pts().features) for (const c of turf.coordAll(f as any)) expect(turf.distance(c, [0.15, 0.15]) * 1000).toBeLessThan(circ.features[0].properties.Radius_m * 1.8);
    const each = run('minimum-bounding-geometry', { input: polysA() }, { group: 'each', kind: 'envelope' }).result;
    expect(each.features).toHaveLength(2);
  });
  it('multipart to singlepart', () => {
    const r = run('multipart-to-singlepart', { input: polysA() }).result;
    expect(r.features).toHaveLength(3);
    expect(r.features.map((f) => f.properties.ORIG_FID)).toEqual([1, 2, 2]);
  });
  it('delete identical', () => {
    const l = layer('d', 'Point', [F({ type: 'Point', coordinates: [1, 1] }, { a: 1 }), F({ type: 'Point', coordinates: [1, 1] }, { a: 2 }), F({ type: 'Point', coordinates: [2, 1] }, { a: 1 })]);
    expect(run('delete-identical', { input: l }).result.features).toHaveLength(2);
    expect(run('delete-identical', { input: l }, { fields: ['a'], geometry: false }).result.features).toHaveLength(2);
    expect(run('delete-identical', { input: l }, { fields: ['a'], geometry: true }).result.features).toHaveLength(3);
  });
  it('select by where clause', () => {
    const r = run('select', { input: polysA() }, { where: 'pop > 8' }).result;
    expect(r.features.map((f) => f.properties.name)).toEqual(['a', 'm']);
    expect(() => run('select', { input: polysA() }, { where: '%%%' })).toThrow(/Invalid expression/);
  });
  it('calculate geometry attributes', () => {
    const r = run('calculate-geometry-attributes', { input: polysA() }, { props: ['AREA', 'PERIMETER', 'CENTROID_X', 'VERTEX_COUNT', 'PART_COUNT'], areaUnit: 'km2', lengthUnit: 'km' }).result;
    expect(r.features[0].properties.Area_km2).toBeCloseTo(area(A) / 1e6, 3);
    expect(r.features[0].properties.Perimeter_km).toBeGreaterThan(80);
    expect(r.features[0].properties.Centroid_X).toBeCloseTo(0.1, 6);
    expect(r.features[1].properties.Part_Count).toBe(2);
    expect(r.features[2].properties.Area_km2).toBeNull();
    expect(r.fields.find((f) => f.name === 'Vertex_Count')!.type).toBe('integer');
  });
});

// ---------- generalization ----------

describe('generalization', () => {
  const wiggle = layer('w', 'LineString', [F({ type: 'LineString', coordinates: Array.from({ length: 101 }, (_, i) => [i * 0.001, (i % 2) * 0.00001]) })]);
  it('simplify reduces vertices', () => {
    const r = run('simplify', { input: wiggle }, { tolerance: { value: 5, unit: 'm' } }).result;
    expect((r.features[0].geometry as any).coordinates.length).toBeLessThan(10);
  });
  it('smooth adds vertices and keeps endpoints', () => {
    const bent = layer('b', 'LineString', [F({ type: 'LineString', coordinates: [[0, 0], [0.1, 0.1], [0.2, 0]] })]);
    const r = run('smooth', { input: bent }, { resolution: 6 }).result;
    const g: any = r.features[0].geometry;
    expect(g.coordinates.length).toBe(2 * 6 + 1);
    expect(g.coordinates[0]).toEqual([0, 0]);
    expect(g.coordinates[g.coordinates.length - 1]).toEqual([0.2, 0]);
    const sq = run('smooth', { input: polysA() }).result;
    expect((sq.features[0].geometry as any).coordinates[0].length).toBe(4 * 8 + 1);
  });
  it('densify adds vertices at the spacing', () => {
    const l = layer('l', 'LineString', [F({ type: 'LineString', coordinates: [[0, 0], [0.1, 0]] })]);
    const r = run('densify', { input: l }, { spacing: { value: 1, unit: 'km' } }).result;
    expect((r.features[0].geometry as any).coordinates.length).toBe(Math.ceil(11.1195) + 1);
  });
});

// ---------- statistics ----------

describe('statistics', () => {
  it('summary statistics with case field', () => {
    const r = run('summary-statistics', { input: pts() }, { stats: [{ field: 'v', stat: 'sum' }, { field: 'v', stat: 'max' }, { field: 'v', stat: 'count' }], cases: ['cat'] }).result;
    expect(r.geomType).toBeNull();
    expect(r.features).toHaveLength(2);
    const even = r.features.find((f) => f.properties.cat === 'even')!;
    expect(even.properties.FREQUENCY).toBe(9);
    expect(r.fields.map((f) => f.name)).toEqual(['cat', 'FREQUENCY', 'SUM_v', 'MAX_v', 'COUNT_v']);
    const all = run('summary-statistics', { input: pts() }, { stats: [{ field: 'v', stat: 'median' }] }).result;
    expect(all.features).toHaveLength(1);
  });
  it('frequency counts combinations and sums', () => {
    const r = run('frequency', { input: pts() }, { fields: ['cat'], sum: ['v'] }).result;
    expect(r.features.map((f) => f.properties.FREQUENCY)).toEqual([9, 9]);
    expect(r.features[0].properties.SUM_v + r.features[1].properties.SUM_v).toBe(120 + 100 + 1);
  });
});

// ---------- surfaces ----------

describe('density and surfaces', () => {
  const cluster = () => {
    const f: GpFeature[] = [];
    for (let i = 0; i < 60; i++) f.push(F({ type: 'Point', coordinates: [0.1 + Math.sin(i) * 0.01 * (i % 5), 0.1 + Math.cos(i * 2) * 0.01 * (i % 4)] }, { w: 1 + (i % 3) }));
    f.push(F({ type: 'Point', coordinates: [0.4, 0.4] }, { w: 1 }));
    return layer('c', 'Point', f);
  };
  it('kernel density outputs ordered contour classes', () => {
    const r = run('kernel-density', { input: cluster() }, { classes: 5, weight: 'w' }).result;
    expect(r.geomType).toBe('Polygon');
    expect(r.features.length).toBeGreaterThanOrEqual(3);
    const cls = r.features.map((f) => f.properties.Class);
    expect(cls).toEqual([...cls].sort((a, b) => a - b));
    expect(r.features[0].properties.Max_Density).toBeLessThanOrEqual(r.features[1].properties.Max_Density);
    // the outermost contour is larger than the innermost
    expect(area(r.features[0].geometry)).toBeGreaterThan(area(r.features[r.features.length - 1].geometry));
  });
  it('idw interpolates bands between the min and max', () => {
    const r = run('idw-interpolation', { input: pts() }, { field: 'v', classes: 4 }).result;
    expect(r.features.length).toBeGreaterThanOrEqual(2);
    expect(r.features[0].properties.Min_Value).toBe(0);
    expect(Math.max(...r.features.map((f) => f.properties.Max_Value))).toBe(100);
  });
  it('aggregate points counts into hex bins', () => {
    const r = run('aggregate-points', { input: pts() }, { size: { value: 4, unit: 'km' }, field: 'v', stat: 'sum' }).result;
    expect(r.features.reduce((s, f) => s + f.properties.Point_Count, 0)).toBe(18); // 16 points + 2 multipoint parts
    expect(r.fields.map((f) => f.name)).toContain('SUM_v');
    const sq = run('aggregate-points', { input: pts() }, { size: { value: 4, unit: 'km' }, shape: 'square' }).result;
    expect(sq.features.reduce((s, f) => s + f.properties.Point_Count, 0)).toBe(18);
  });
});

// ---------- generate ----------

describe('generate tools', () => {
  it('tessellation covers the extent', () => {
    const sq = run('generate-tessellation', { extent: polysA() }, { shape: 'square', size: { value: 5, unit: 'km' } }).result;
    expect(sq.features.length).toBeGreaterThan(20);
    expect(sq.fields[0].name).toBe('GRID_ID');
    for (const shape of ['hexagon', 'triangle']) expect(run('generate-tessellation', { extent: polysA() }, { shape, size: { value: 5, unit: 'km' } }).result.features.length).toBeGreaterThan(5);
    expect(() => run('generate-tessellation', { extent: polysA() }, { size: { value: 1, unit: 'm' } })).toThrow(/cells/);
  });
  it('random points land inside the polygons, with seed reproducibility and spacing', () => {
    const a = run('create-random-points', { constraint: polysA() }, { count: 50, seed: 42 }).result;
    const b = run('create-random-points', { constraint: polysA() }, { count: 50, seed: 42 }).result;
    expect(a.features).toHaveLength(50);
    expect(a.features.map((f) => f.geometry)).toEqual(b.features.map((f) => f.geometry));
    for (const f of a.features) {
      const ok = turf.booleanPointInPolygon(f.geometry as any, A) || turf.booleanPointInPolygon(f.geometry as any, multi);
      expect(ok).toBe(true);
    }
    const spaced = run('create-random-points', { constraint: polysA() }, { count: 20, seed: 3, minDistance: { value: 1, unit: 'km' } }).result;
    for (let i = 0; i < spaced.features.length; i++)
      for (let j = i + 1; j < spaced.features.length; j++)
        expect(turf.distance(spaced.features[i].geometry as any, spaced.features[j].geometry as any) * 1000).toBeGreaterThanOrEqual(999);
    const per = run('create-random-points', { constraint: polysA() }, { count: 5, perFeature: true, seed: 1 }).result;
    expect(per.features).toHaveLength(10);
    const ext = run('create-random-points', { constraint: lines() }, { mode: 'extent', count: 7, seed: 2 }).result;
    expect(ext.features).toHaveLength(7);
    expect(() => run('create-random-points', { constraint: lines() }, { count: 5 })).toThrow(/polygon/);
  });
  it('xy to line and bearing distance', () => {
    const r = run('xy-to-line', { input: table() }, { x1: 'ox', y1: 'oy', x2: 'dx', y2: 'dy' }).result;
    expect(r.features).toHaveLength(3);
    expect(r.features[0].properties.Length_km).toBeGreaterThan(1500);
    const straight = run('xy-to-line', { input: table() }, { x1: 'ox', y1: 'oy', x2: 'dx', y2: 'dy', type: 'straight' }).result;
    expect((straight.features[1].geometry as any).coordinates).toEqual([[10, 10], [-20, 40]]);
    const bd = run('bearing-distance-to-line', { input: table() }, { x: 'ox', y: 'oy', bearingField: 'brg', distanceField: 'd', distance: { value: 100, unit: 'km' } }).result;
    expect(bd.features).toHaveLength(3);
    // 5 (field value) x 100 km would be 500 km; the unit of the fixed distance (km) applies to the field, so 5 km due east
    expect(bd.features[0].properties.End_X).toBeCloseTo(5 / 111.195, 3);
    expect(bd.features[0].properties.End_Y).toBeCloseTo(0, 4);
    expect(bd.features[0].properties.Distance_m).toBe(5000);
  });
});

// ---------- registry-wide checks ----------

describe('tool registry', () => {
  it('has at least 30 well-formed tools', () => {
    expect(ALL_TOOLS.length).toBeGreaterThanOrEqual(30);
    const ids = new Set(ALL_TOOLS.map((t) => t.id));
    expect(ids.size).toBe(ALL_TOOLS.length);
    for (const t of ALL_TOOLS) {
      expect(t.description.length, t.id).toBeGreaterThan(40);
      expect(t.keywords.length, t.id).toBeGreaterThan(0);
      expect(getTool(t.id)).toBe(t);
      for (const p of t.params) {
        expect(p.help.length, `${t.id}.${p.name}`).toBeGreaterThan(5);
        if ('layer' in p && typeof p.layer === 'string') expect(t.params.some((q) => q.name === p.layer && q.kind === 'layer'), `${t.id}.${p.name}`).toBe(true);
      }
      expect(t.params.some((p) => p.kind === 'output'), t.id).toBe(true);
    }
  });

  it('every tool survives multipart and null geometry input (smoke)', () => {
    const P = polysA(), Q = polysB(), PT = pts(), LN = lines(), TB = table();
    const smoke: Record<string, [Record<string, any>, Record<string, any>]> = {
      buffer: [{ input: P }, {}],
      'multiple-ring-buffer': [{ input: LN }, {}],
      near: [{ input: P, near: PT }, {}],
      'create-thiessen-polygons': [{ input: PT }, {}],
      clip: [{ input: LN, clip: P }, {}],
      intersect: [{ input: P, overlay: Q }, {}],
      union: [{ input: P, overlay: Q }, {}],
      erase: [{ input: PT, erase: P }, {}],
      'symmetrical-difference': [{ input: P, overlay: Q }, {}],
      dissolve: [{ input: LN }, {}],
      merge: [{ inputs: [P, Q] }, {}],
      'spatial-join': [{ target: P, join: PT }, {}],
      'summarize-within': [{ polygons: P, points: PT }, {}],
      'count-overlapping': [{ input: P }, {}],
      'tabulate-intersection': [{ zones: P, classes: LN }, {}],
      'feature-to-point': [{ input: LN }, {}],
      'feature-vertices-to-points': [{ input: LN }, {}],
      'polygon-to-line': [{ input: P }, {}],
      'feature-to-polygon': [{ input: P }, {}],
      'points-to-line': [{ input: PT }, {}],
      'minimum-bounding-geometry': [{ input: LN }, {}],
      'multipart-to-singlepart': [{ input: PT }, {}],
      'delete-identical': [{ input: TB }, {}],
      select: [{ input: TB }, { where: 'd > 1' }],
      'calculate-geometry-attributes': [{ input: LN }, { props: ['LENGTH', 'VERTEX_COUNT'] }],
      simplify: [{ input: P }, {}],
      smooth: [{ input: LN }, {}],
      densify: [{ input: P }, {}],
      'summary-statistics': [{ input: TB }, { stats: [{ field: 'd', stat: 'sum' }] }],
      frequency: [{ input: TB }, { fields: ['g'] }],
      'kernel-density': [{ input: PT }, {}],
      'idw-interpolation': [{ input: PT }, { field: 'v' }],
      'aggregate-points': [{ input: PT }, { size: { value: 5, unit: 'km' } }],
      'generate-tessellation': [{ extent: LN }, { size: { value: 10, unit: 'km' } }],
      'create-random-points': [{ constraint: P }, { count: 5 }],
      'xy-to-line': [{ input: TB }, { x1: 'ox', y1: 'oy', x2: 'dx', y2: 'dy' }],
      'bearing-distance-to-line': [{ input: PT }, {}],
    };
    for (const t of ALL_TOOLS) {
      const entry = smoke[t.id];
      expect(entry, `smoke case for ${t.id}`).toBeDefined();
      const before = JSON.stringify(Object.values(entry[0]).flat().map((l: any) => l.features));
      const r = runToolById(t.id, Object.fromEntries(Object.entries(entry[0]).map(([k, v]) => [k, Array.isArray(v) ? v : [v]])), entry[1]);
      expect(r.features.length, t.id).toBeGreaterThan(0);
      for (const f of r.features) for (const fl of r.fields) expect(fl.name in f.properties, `${t.id}.${fl.name}`).toBe(true);
      expect(JSON.stringify(Object.values(entry[0]).flat().map((l: any) => l.features)), `${t.id} must not mutate inputs`).toBe(before);
    }
  });
});
