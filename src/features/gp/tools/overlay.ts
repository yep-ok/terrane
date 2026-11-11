// Overlay tools: Clip, Intersect, Union, Erase, Symmetrical Difference, Dissolve, Merge,
// Spatial Join, Summarize Within, Count Overlapping Features, Tabulate Intersection.
import type { Geometry } from 'geojson';
import {
  Mask, asPolygonal, buildResult, clipGeometry, differencePolys, geomAreaM2, geomFromParts, geomLengthM, groupBy,
  fieldsOfNames, mergeSchemas, mkFeature, nearestItem, pointsOf, polygonsOf, pointInPolys, renamed, statFields, statValues, cleanStats,
  intersectPolys, unionPolys, linesOf, coordsOf, bboxOf, expandBoxM, GridIndex, toMeters, uniqueName,
} from '../geo';
import { ANY_GEOM, POLY, POINT, boolP, choiceP, distP, fieldP, fieldsP, layerP, outP, statsP } from '../params';
import { ToolError, type Field, type GeomType, type GpFeature, type ToolDef } from '../types';
import { AREA_M2, AREA_UNITS, LENGTH_M, LENGTH_UNITS, fieldType, indexLayer, intersectsGeom, layerMask, ticker, warnIfSkipped, withGeom, withinGeom } from './common';

const CAT = 'Overlay';

// ---------- Clip ----------

export const clip: ToolDef = {
  id: 'clip',
  name: 'Clip',
  category: CAT,
  description:
    'Cuts the input features to the outline of the clip polygons. Points inside are kept, lines are cut where they cross the boundary, and polygons are trimmed. Attributes come from the input layer only.',
  keywords: ['cut', 'extract', 'mask', 'crop', 'boundary'],
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons to be clipped.', geom: ANY_GEOM }),
    layerP('clip', 'Clip features', { help: 'Polygons that define the area to keep.', geom: POLY }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input'), clipL = ctx.layer('clip');
    const mask = layerMask(clipL);
    const { boxes, index } = indexLayer(clipL.features);
    const tick = ticker(ctx, input.features.length, 'Clipping feature');
    const out: GpFeature[] = [];
    let skipped = 0;
    input.features.forEach((f, i) => {
      tick(i);
      if (!f.geometry) return void skipped++;
      let g: Geometry | null = null;
      if (input.geomType === 'Polygon') {
        const box = bboxOf(f.geometry);
        const cands = box ? index.query(box).map((k) => asPolygonal(clipL.features[k].geometry)!).filter(Boolean) : [];
        const clipGeom = cands.length === 1 ? cands[0] : unionPolys(cands);
        const pg = asPolygonal(f.geometry);
        g = pg && clipGeom ? intersectPolys(pg, clipGeom) : null;
      } else g = clipGeometry(f.geometry, mask, true);
      if (g && coordsOf(g).length) out.push(mkFeature(g, { ...f.properties }, f.id));
    });
    void boxes;
    warnIfSkipped(ctx, skipped, 'features without geometry');
    ctx.message(`${out.length.toLocaleString()} of ${input.features.length.toLocaleString()} features fall inside the clip area.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Intersect ----------

export const intersect: ToolDef = {
  id: 'intersect',
  name: 'Intersect',
  category: CAT,
  description:
    'Computes the geometric intersection of two layers. Only the parts that overlap are kept, and every output feature carries the attributes of both inputs. At least one input must be a polygon layer; the output has the geometry type of the lower-dimension input.',
  keywords: ['overlap', 'common', 'both', 'and'],
  params: [
    layerP('input', 'Input features', { help: 'First layer. Points, lines or polygons.', geom: ANY_GEOM }),
    layerP('overlay', 'Intersect features', { help: 'Second layer. Points, lines or polygons.', geom: ANY_GEOM }),
    outP(),
  ],
  run(ctx) {
    const A = ctx.layer('input'), B = ctx.layer('overlay');
    if (A.geomType !== 'Polygon' && B.geomType !== 'Polygon') throw new ToolError('Intersect needs at least one polygon layer.');
    const swap = A.geomType === 'Polygon' && B.geomType !== 'Polygon';
    const S = swap ? B : A; // subject (lower dimension)
    const P = swap ? A : B; // polygon layer
    const { fields, rename } = mergeSchemas(A.fields, B.fields);
    const { index } = indexLayer(P.features);
    const pg = P.features.map((f) => asPolygonal(f.geometry));
    const masks: Array<Mask | undefined> = [];
    const out: GpFeature[] = [];
    const tick = ticker(ctx, S.features.length, 'Intersecting feature');
    S.features.forEach((s, i) => {
      tick(i);
      if (!s.geometry) return;
      const box = bboxOf(s.geometry);
      if (!box) return;
      for (const k of index.query(box)) {
        const p = pg[k];
        if (!p) continue;
        let g: Geometry | null;
        if (S.geomType === 'Polygon') {
          const sg = asPolygonal(s.geometry);
          g = sg ? intersectPolys(sg, p) : null;
        } else g = clipGeometry(s.geometry, (masks[k] ??= new Mask(p)), true);
        if (!g || !coordsOf(g).length) continue;
        const a = swap ? P.features[k] : s, b = swap ? s : P.features[k];
        out.push(mkFeature(g, { ...a.properties, ...renamed(b.properties, rename) }));
      }
    });
    ctx.message(`${out.length.toLocaleString()} intersection features created.`);
    return buildResult(out, { geomType: swap ? B.geomType : A.geomType, fields });
  },
};

// ---------- Union ----------

function overlayPieces(ctx: Parameters<ToolDef['run']>[0], mode: 'union' | 'symdiff') {
  const A = ctx.layer('input'), B = ctx.layer('overlay');
  const { fields, rename } = mergeSchemas(A.fields, B.fields);
  const pa = A.features.map((f) => asPolygonal(f.geometry));
  const pb = B.features.map((f) => asPolygonal(f.geometry));
  const ia = indexLayer(A.features).index, ib = indexLayer(B.features).index;
  const out: GpFeature[] = [];
  const nullB: Record<string, any> = {};
  for (const f of B.fields) nullB[rename.get(f.name) ?? f.name] = null;
  const nullA: Record<string, any> = {};
  for (const f of A.fields) nullA[f.name] = null;
  const total = A.features.length + B.features.length;
  const tick = ticker(ctx, total, 'Overlaying feature');
  A.features.forEach((a, i) => {
    tick(i);
    const g = pa[i];
    if (!g) return;
    const cands = ib.query(bboxOf(g)!).filter((k) => pb[k]);
    if (mode === 'union')
      for (const k of cands) {
        const x = intersectPolys(g, pb[k]!);
        if (x && polygonsOf(x).length) out.push(mkFeature(x, { ...a.properties, ...renamed(B.features[k].properties, rename) }));
      }
    const rest = differencePolys(g, cands.map((k) => pb[k]!));
    if (rest && polygonsOf(rest).length) out.push(mkFeature(rest, { ...a.properties, ...nullB }));
  });
  B.features.forEach((b, i) => {
    tick(A.features.length + i);
    const g = pb[i];
    if (!g) return;
    const cands = ia.query(bboxOf(g)!).filter((k) => pa[k]);
    const rest = differencePolys(g, cands.map((k) => pa[k]!));
    if (rest && polygonsOf(rest).length) out.push(mkFeature(rest, { ...nullA, ...renamed(b.properties, rename) }));
  });
  return buildResult(out, { geomType: 'Polygon', fields });
}

export const union: ToolDef = {
  id: 'union',
  name: 'Union',
  category: CAT,
  description:
    'Combines two polygon layers into one. The output contains the overlapping parts (with the attributes of both layers) and the non-overlapping parts of each layer (with the other layer\'s attributes empty).',
  keywords: ['combine', 'overlay', 'merge polygons'],
  params: [
    layerP('input', 'Input features', { help: 'First polygon layer.', geom: POLY }),
    layerP('overlay', 'Union features', { help: 'Second polygon layer.', geom: POLY }),
    outP(),
  ],
  run: (ctx) => overlayPieces(ctx, 'union'),
};

export const symDiff: ToolDef = {
  id: 'symmetrical-difference',
  name: 'Symmetrical Difference',
  category: CAT,
  description:
    'Keeps the parts of both polygon layers that do not overlap each other, i.e. everything except the intersection. Each piece keeps the attributes of the layer it came from.',
  keywords: ['xor', 'non overlapping', 'difference'],
  outputPrefix: 'SymDiff',
  params: [
    layerP('input', 'Input features', { help: 'First polygon layer.', geom: POLY }),
    layerP('overlay', 'Update features', { help: 'Second polygon layer.', geom: POLY }),
    outP(),
  ],
  run: (ctx) => overlayPieces(ctx, 'symdiff'),
};

// ---------- Erase ----------

export const erase: ToolDef = {
  id: 'erase',
  name: 'Erase',
  category: CAT,
  description: 'Removes the parts of the input features that overlap the erase polygons. Works for points, lines and polygons; attributes are kept.',
  keywords: ['remove', 'subtract', 'difference', 'cut out'],
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons to erase from.', geom: ANY_GEOM }),
    layerP('erase', 'Erase features', { help: 'Polygons that define the area to remove.', geom: POLY }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input'), er = ctx.layer('erase');
    const { index } = indexLayer(er.features);
    const mask = layerMask(er);
    const epoly = er.features.map((f) => asPolygonal(f.geometry));
    const out: GpFeature[] = [];
    const tick = ticker(ctx, input.features.length, 'Erasing feature');
    let skipped = 0;
    input.features.forEach((f, i) => {
      tick(i);
      if (!f.geometry) return void skipped++;
      let g: Geometry | null;
      if (input.geomType === 'Polygon') {
        const pg = asPolygonal(f.geometry);
        const cands = pg ? index.query(bboxOf(pg)!).map((k) => epoly[k]!).filter(Boolean) : [];
        g = pg ? differencePolys(pg, cands) : null;
      } else g = clipGeometry(f.geometry, mask, false);
      if (g && coordsOf(g).length) out.push(mkFeature(g, { ...f.properties }, f.id));
    });
    warnIfSkipped(ctx, skipped, 'features without geometry');
    ctx.message(`${(input.features.length - out.length).toLocaleString()} features were removed entirely.`);
    return buildResult(out, { geomType: input.geomType, fields: input.fields });
  },
};

// ---------- Dissolve ----------

export const dissolve: ToolDef = {
  id: 'dissolve',
  name: 'Dissolve',
  category: CAT,
  description:
    'Aggregates features that share the same values in the chosen fields into single features. Polygons are merged (shared boundaries disappear); lines and points become multipart features. Optional statistics summarise numeric fields per group.',
  keywords: ['merge', 'aggregate', 'combine', 'group', 'unify'],
  params: [
    layerP('input', 'Input features', { help: 'Points, lines or polygons.', geom: ANY_GEOM }),
    fieldsP('fields', 'Dissolve fields', 'input', { help: 'Features with identical values in these fields are merged. Leave empty to merge everything into one feature.' }),
    statsP('stats', 'Statistics', 'input', { help: 'Numeric fields to summarise for each dissolved feature.' }),
    boolP('multipart', 'Create multipart features', true, { help: 'When off, each separate piece of a dissolved result becomes its own feature.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const names: string[] = (ctx.params.fields ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
    const stats = cleanStats(ctx.params.stats, input);
    const fam = input.geomType as GeomType;
    const groups = groupBy(input.features.filter((f) => f.geometry && coordsOf(f.geometry).length), names);
    const out: GpFeature[] = [];
    const tick = ticker(ctx, groups.size, 'Dissolving group');
    let gi = 0;
    for (const rows of groups.values()) {
      tick(gi++);
      const props: Record<string, any> = {};
      for (const n of names) props[n] = rows[0].properties[n] ?? null;
      Object.assign(props, statValues(stats, rows));
      let parts: Geometry[];
      if (fam === 'Polygon') {
        const u = unionPolys(rows.map((r) => r.geometry!));
        parts = u ? [u] : [];
      } else {
        const g = geomFromParts(fam, rows.flatMap((r) => (fam === 'Point' ? pointsOf(r.geometry) : linesOf(r.geometry))));
        parts = g ? [g] : [];
      }
      for (const g of parts) {
        if (ctx.params.multipart || g.type === 'Polygon' || g.type === 'LineString' || g.type === 'Point') out.push(mkFeature(g, props));
        else if (g.type === 'MultiPolygon') for (const c of g.coordinates) out.push(mkFeature({ type: 'Polygon', coordinates: c }, { ...props }));
        else if (g.type === 'MultiLineString') for (const c of g.coordinates) out.push(mkFeature({ type: 'LineString', coordinates: c }, { ...props }));
        else if (g.type === 'MultiPoint') for (const c of g.coordinates) out.push(mkFeature({ type: 'Point', coordinates: c }, { ...props }));
      }
    }
    ctx.message(`${input.features.length.toLocaleString()} features dissolved into ${out.length.toLocaleString()}.`);
    return buildResult(out, { geomType: input.geomType, fields: [...fieldsOfNames(input, names), ...statFields(stats, input.fields)] });
  },
};

// ---------- Merge ----------

export const merge: ToolDef = {
  id: 'merge',
  name: 'Merge',
  category: CAT,
  description:
    'Appends the features of several layers of the same geometry type into one layer. Fields with the same name are combined; fields that exist in only some layers are filled with empty values for the others.',
  keywords: ['append', 'combine', 'join layers', 'stack'],
  params: [
    layerP('inputs', 'Input layers', { help: 'Two or more layers with the same geometry type.', geom: [...ANY_GEOM, 'Table'], multiple: true }),
    boolP('source', 'Add source layer field', false, { help: 'Adds a field "Source_Layer" with the name of the layer each feature came from.' }),
    outP(),
  ],
  run(ctx) {
    const layers = ctx.inputs.inputs ?? [];
    if (layers.length < 2) throw new ToolError('Merge needs at least two input layers.');
    const fam = layers[0].geomType;
    const used = layers.filter((l) => l.geomType === fam);
    if (used.length < layers.length) ctx.message(`${layers.length - used.length} layer(s) with a different geometry type were skipped.`, 'warning');
    const fields: Field[] = [];
    for (const l of used)
      for (const f of l.fields) {
        const have = fields.find((x) => x.name === f.name);
        if (!have) fields.push({ ...f });
        else if (have.type !== f.type) have.type = (have.type === 'integer' && f.type === 'number') || (have.type === 'number' && f.type === 'integer') ? 'number' : 'string';
      }
    const srcName = ctx.params.source ? uniqueName('Source_Layer', fields.map((f) => f.name)) : '';
    if (srcName) fields.push({ name: srcName, type: 'string' });
    const out: GpFeature[] = [];
    for (const l of used)
      for (const f of l.features) out.push(mkFeature(f.geometry, { ...f.properties, ...(srcName ? { [srcName]: l.name } : {}) }));
    ctx.message(`Merged ${used.length} layers into ${out.length.toLocaleString()} features.`);
    return buildResult(out, { geomType: fam, fields });
  },
};

// ---------- Spatial Join ----------

export const spatialJoin: ToolDef = {
  id: 'spatial-join',
  name: 'Spatial Join',
  category: CAT,
  description:
    'Transfers information from a join layer to a target layer based on how they relate in space (one-to-one: each target feature appears once). Adds Join_Count and, optionally, the sum, mean, min or max of a numeric join field and the attributes of the first match.',
  keywords: ['join', 'transfer attributes', 'count', 'nearest', 'within', 'intersects', 'contains'],
  params: [
    layerP('target', 'Target features', { help: 'Features that receive the information.', geom: ANY_GEOM }),
    layerP('join', 'Join features', { help: 'Features that provide the information.', geom: ANY_GEOM }),
    choiceP('match', 'Match option', 'intersects', [
      ['intersects', 'Intersects'], ['within', 'Target is within join feature'], ['contains', 'Target contains join feature'],
      ['within_distance', 'Within a distance'], ['closest', 'Closest (single nearest)'],
    ], { help: 'The spatial relationship that decides which join features match a target feature.' }),
    distP('distance', 'Search distance', { value: 1, unit: 'km' }, {
      help: 'Used by "Within a distance" and "Closest". For Closest, 0 means no limit.', min: 0,
      showIf: (v) => v.match === 'within_distance' || v.match === 'closest',
    }),
    fieldP('field', 'Summarize field', 'join', { help: 'Numeric join field to summarise over all matches.', optional: true, allowNone: true, types: ['number', 'integer'] }),
    choiceP('stat', 'Summary statistic', 'sum', [['sum', 'Sum'], ['mean', 'Mean'], ['min', 'Minimum'], ['max', 'Maximum']], {
      help: 'How the matched values are combined.', showIf: (v) => !!v.field,
    }),
    boolP('copy', 'Copy first match attributes', true, { help: 'Adds the attributes of the first matching join feature (or the nearest one for Closest).' }),
    outP(),
  ],
  run(ctx) {
    const T = ctx.layer('target'), J = ctx.layer('join');
    const match = String(ctx.params.match);
    const distM = toMeters(ctx.params.distance);
    const field: string = ctx.params.field || '';
    const stat = ctx.params.stat === 'mean' || ctx.params.stat === 'min' || ctx.params.stat === 'max' ? ctx.params.stat : 'sum';
    const { boxes, index } = indexLayer(J.features);
    const items = J.features.map((f, i) => ({ geom: f.geometry, box: boxes[i] }));
    const { fields: merged, rename } = mergeSchemas(T.fields, J.fields);
    const used = new Set(merged.map((f) => f.name));
    const countName = uniqueName('Join_Count', used);
    used.add(countName);
    const distName = match === 'closest' ? uniqueName('Join_Distance_m', used) : '';
    if (distName) used.add(distName);
    const statName = field ? uniqueName(`${stat.toUpperCase()}_${field}`, used) : '';
    const fields: Field[] = [...(ctx.params.copy ? merged : T.fields), { name: countName, type: 'integer' }];
    if (distName) fields.push({ name: distName, type: 'number' });
    if (statName) fields.push({ name: statName, type: 'number' });
    const nullJoin: Record<string, any> = {};
    if (ctx.params.copy) for (const f of J.fields) nullJoin[rename.get(f.name) ?? f.name] = null;
    const tick = ticker(ctx, T.features.length, 'Joining feature');
    const out = T.features.map((t, ti) => {
      tick(ti);
      let matches: number[] = [];
      let nearD: number | null = null;
      const g = t.geometry;
      const tb = bboxOf(g);
      if (g && tb) {
        if (match === 'closest') {
          const n = nearestItem(g, items, index, distM);
          if (n) {
            matches = [n.i];
            nearD = n.d;
          }
        } else {
          const search = match === 'within_distance' ? expandBoxM(tb, distM) : tb;
          for (const k of index.query(search)) {
            const jg = J.features[k].geometry;
            if (!jg) continue;
            let ok: boolean;
            if (match === 'intersects') ok = intersectsGeom(g, jg);
            else if (match === 'within') ok = withinGeom(g, jg);
            else if (match === 'contains') ok = withinGeom(jg, g);
            else ok = intersectsGeom(g, jg) || nearestDistance(g, jg) <= distM;
            if (ok) matches.push(k);
          }
        }
      }
      const props: Record<string, any> = { ...t.properties, ...(ctx.params.copy ? nullJoin : {}) };
      if (ctx.params.copy && matches.length) Object.assign(props, renamed(J.features[matches[0]].properties, rename));
      props[countName] = matches.length;
      if (distName) props[distName] = nearD;
      if (statName) {
        const vals = matches
          .map((k) => J.features[k].properties[field])
          .filter((v) => v !== null && v !== undefined && v !== '')
          .map(Number)
          .filter((v) => Number.isFinite(v));
        props[statName] = vals.length ? aggregate(vals, stat) : matches.length ? null : stat === 'sum' ? 0 : null;
      }
      return mkFeature(t.geometry, props, t.id);
    });
    const matched = out.filter((f) => (f.properties[countName] as number) > 0).length;
    ctx.message(`${matched.toLocaleString()} of ${out.length.toLocaleString()} target features have at least one match.`);
    return buildResult(out, { geomType: T.geomType, fields });
  },
};
const nearestDistance = (a: Geometry, b: Geometry) => {
  const items = [{ geom: b, box: bboxOf(b) }];
  return nearestItem(a, items, new GridIndex([items[0].box]), 0)?.d ?? Infinity;
};
function aggregate(vals: number[], stat: string): number {
  if (stat === 'mean') return vals.reduce((a, b) => a + b, 0) / vals.length;
  if (stat === 'min') return Math.min(...vals);
  if (stat === 'max') return Math.max(...vals);
  return vals.reduce((a, b) => a + b, 0);
}

// ---------- Summarize Within ----------

export const summarizeWithin: ToolDef = {
  id: 'summarize-within',
  name: 'Summarize Within',
  category: CAT,
  description:
    'Counts the points that fall inside each polygon and optionally summarises their numeric fields (sum, mean, min, max...). The output is the polygon layer with Point_Count and the chosen statistics added.',
  keywords: ['count points in polygon', 'aggregate', 'zonal', 'statistics', 'points in polygons'],
  params: [
    layerP('polygons', 'Summary polygons', { help: 'Polygons to summarise into.', geom: POLY }),
    layerP('points', 'Points to summarize', { help: 'Point features to count.', geom: POINT }),
    statsP('stats', 'Statistics', 'points', { help: 'Numeric point fields to summarise for each polygon.' }),
    boolP('onlyHits', 'Keep only polygons containing points', false, { help: 'Drops polygons with a count of zero from the output.' }),
    outP(),
  ],
  run(ctx) {
    const P = ctx.layer('polygons'), Pts = ctx.layer('points');
    const stats = cleanStats(ctx.params.stats, Pts);
    const polys = P.features.map((f) => polygonsOf(f.geometry));
    const boxes = P.features.map((f) => bboxOf(f.geometry));
    const index = new GridIndex(boxes);
    const hits: GpFeature[][] = P.features.map(() => []);
    const tick = ticker(ctx, Pts.features.length, 'Locating point');
    Pts.features.forEach((pf, i) => {
      tick(i);
      for (const p of pointsOf(pf.geometry))
        for (const k of index.query([p[0], p[1], p[0], p[1]])) if (pointInPolys(p, polys[k])) hits[k].push(pf);
    });
    const countName = uniqueName('Point_Count', P.fields.map((f) => f.name));
    const sf = statFields(stats, Pts.fields);
    const names = new Set([...P.fields.map((f) => f.name), countName]);
    const rename = new Map<string, string>();
    const statCols = sf.map((f) => {
      const n = uniqueName(f.name, names);
      names.add(n);
      rename.set(f.name, n);
      return { ...f, name: n };
    });
    const out: GpFeature[] = [];
    P.features.forEach((f, i) => {
      if (ctx.params.onlyHits && !hits[i].length) return;
      out.push(mkFeature(f.geometry, { ...f.properties, [countName]: hits[i].length, ...renamed(statValues(stats, hits[i]), rename) }, f.id));
    });
    ctx.message(`${Pts.features.length.toLocaleString()} points summarised into ${P.features.length.toLocaleString()} polygons.`);
    return buildResult(out, { geomType: 'Polygon', fields: [...P.fields, { name: countName, type: 'integer' }, ...statCols] });
  },
};

// ---------- Count Overlapping Features ----------

export const countOverlapping: ToolDef = {
  id: 'count-overlapping',
  name: 'Count Overlapping Features',
  category: CAT,
  description:
    'Breaks a polygon layer into the pieces where polygons overlap and records how many input features cover each piece. Useful for finding hot spots of overlapping service areas or footprints.',
  keywords: ['overlap', 'coverage', 'stack', 'depth', 'count polygons'],
  params: [
    layerP('input', 'Input polygons', { help: 'Polygon features that may overlap.', geom: POLY }),
    { kind: 'number', name: 'minCount', label: 'Minimum count', default: 1, min: 1, integer: true, optional: true, help: 'Pieces covered by fewer features than this are dropped. Use 2 to keep only overlaps.' },
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const minCount = Math.max(1, Math.round(Number(ctx.params.minCount) || 1));
    let pieces: Array<{ g: Geometry; ids: Array<number | string>; box: [number, number, number, number] }> = [];
    const polys = withGeom(input);
    const tick = ticker(ctx, polys.length, 'Overlaying feature');
    polys.forEach((f, n) => {
      tick(n);
      const fg = asPolygonal(f.geometry);
      const fb = fg && bboxOf(fg);
      if (!fg || !fb) return;
      const id = f.id ?? n + 1;
      const next: typeof pieces = [];
      const touched: Geometry[] = [];
      for (const p of pieces) {
        if (p.box[0] > fb[2] || p.box[2] < fb[0] || p.box[1] > fb[3] || p.box[3] < fb[1]) {
          next.push(p);
          continue;
        }
        const inter = intersectPolys(p.g, fg);
        if (!inter || !polygonsOf(inter).length) {
          next.push(p);
          continue;
        }
        touched.push(inter);
        next.push({ g: inter, ids: [...p.ids, id], box: bboxOf(inter)! });
        const rest = differencePolys(p.g, [fg]);
        if (rest && polygonsOf(rest).length) next.push({ g: rest, ids: p.ids, box: bboxOf(rest)! });
      }
      const fresh = touched.length ? differencePolys(fg, touched) : fg;
      if (fresh && polygonsOf(fresh).length) next.push({ g: fresh, ids: [id], box: bboxOf(fresh)! });
      pieces = next;
    });
    const out = pieces
      .filter((p) => p.ids.length >= minCount)
      .map((p) => mkFeature(p.g, { Overlap_Count: p.ids.length, Source_FIDs: p.ids.join(',') }));
    ctx.message(`${out.length.toLocaleString()} pieces created; maximum overlap is ${Math.max(0, ...pieces.map((p) => p.ids.length))}.`);
    return buildResult(out, { geomType: 'Polygon', fields: [{ name: 'Overlap_Count', type: 'integer' }, { name: 'Source_FIDs', type: 'string' }] });
  },
};

// ---------- Tabulate Intersection ----------

export const tabulateIntersection: ToolDef = {
  id: 'tabulate-intersection',
  name: 'Tabulate Intersection',
  category: CAT,
  description:
    'Cross-tabulates how much of each class (polygon area, line length or point count) lies inside each zone polygon. The result is a table with one row per zone and class, plus the percentage of the zone covered (polygon classes) or the share of the class total inside the zone (lines and points).',
  keywords: ['cross tab', 'zones', 'area by class', 'land cover', 'table'],
  outputPrefix: 'Tabulate',
  params: [
    layerP('zones', 'Zone features', { help: 'Polygons that define the zones.', geom: POLY }),
    fieldP('zoneField', 'Zone field', 'zones', { help: 'Field that identifies each zone. When empty, the feature ID is used.', optional: true, allowNone: true }),
    layerP('classes', 'Class features', { help: 'Polygons, lines or points to tabulate.', geom: ANY_GEOM }),
    fieldP('classField', 'Class field', 'classes', { help: 'Field with the class value. When empty, all features are one class.', optional: true, allowNone: true }),
    choiceP('areaUnit', 'Area unit', 'km2', AREA_UNITS, { help: 'Unit for polygon class areas.' }),
    choiceP('lengthUnit', 'Length unit', 'km', LENGTH_UNITS, { help: 'Unit for line class lengths.' }),
    outP(),
  ],
  run(ctx) {
    const Z = ctx.layer('zones'), C = ctx.layer('classes');
    const zf: string = ctx.params.zoneField || '', cf: string = ctx.params.classField || '';
    const au = String(ctx.params.areaUnit), lu = String(ctx.params.lengthUnit);
    const { index } = indexLayer(C.features);
    const measureName = C.geomType === 'Polygon' ? `Area_${au}` : C.geomType === 'LineString' ? `Length_${lu}` : 'Count';
    const rows: GpFeature[] = [];
    const tick = ticker(ctx, Z.features.length, 'Tabulating zone');
    Z.features.forEach((z, zi) => {
      tick(zi);
      const zg = asPolygonal(z.geometry);
      if (!zg) return;
      const zmask = new Mask(zg);
      const zoneArea = geomAreaM2(zg);
      const acc = new Map<string, number>();
      for (const k of index.query(bboxOf(zg)!)) {
        const c = C.features[k];
        if (!c.geometry) continue;
        const piece = C.geomType === 'Polygon' ? intersectPolys(asPolygonal(c.geometry)!, zg) : clipGeometry(c.geometry, zmask, true);
        if (!piece) continue;
        const v = C.geomType === 'Polygon' ? geomAreaM2(piece) / AREA_M2[au] : C.geomType === 'LineString' ? geomLengthM(piece) / LENGTH_M[lu] : pointsOf(piece).length;
        if (!v) continue;
        const cls = cf ? String(c.properties[cf] ?? '') : 'All';
        acc.set(cls, (acc.get(cls) ?? 0) + v);
      }
      const sum = [...acc.values()].reduce((a, b) => a + b, 0);
      const zoneVal = zf ? z.properties[zf] ?? null : z.id ?? zi + 1;
      for (const [cls, v] of acc) {
        const pct = C.geomType === 'Polygon' ? (zoneArea ? ((v * AREA_M2[au]) / zoneArea) * 100 : 0) : sum ? (v / sum) * 100 : 0;
        rows.push(mkFeature(null, { Zone: zoneVal, Class: cls, [measureName]: v, Percent: Math.round(pct * 1000) / 1000 }));
      }
    });
    const zoneType = zf ? fieldType(Z, zf) : 'integer';
    ctx.message(`${rows.length.toLocaleString()} zone/class combinations tabulated.`);
    return buildResult(rows, {
      geomType: null,
      fields: [{ name: 'Zone', type: zoneType }, { name: 'Class', type: 'string' }, { name: measureName, type: C.geomType === 'Point' ? 'integer' : 'number' }, { name: 'Percent', type: 'number' }],
    });
  },
};

export const OVERLAY_TOOLS: ToolDef[] = [
  clip, intersect, union, erase, symDiff, dissolve, merge, spatialJoin, summarizeWithin, countOverlapping, tabulateIntersection,
];
