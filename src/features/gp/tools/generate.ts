// Generate tools: Tessellation, Random Points, XY To Line, Bearing Distance To Line.
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import {
  GridIndex, M_PER_DEG, R, RAD, bboxOf, bboxUnion, buildResult, expandBoxM, gcInterp, geomAreaM2, haversine, layerBBox, mkFeature, mulberry32, pointInPolys, polygonsOf, toMeters, uniqueName,
  type BBox, type Pos,
} from '../geo';
import { ANY_GEOM, ANY_OR_TABLE, NUMERIC, POLY, boolP, choiceP, distP, fieldP, layerP, numP, outP } from '../params';
import { ToolError, type Field, type GpFeature, type ToolDef } from '../types';
import { gridBox, indexLayer, intersectsGeom, ticker, warnIfSkipped } from './common';

const CAT = 'Generate';

// ---------- Generate Tessellation ----------

export const tessellation: ToolDef = {
  id: 'generate-tessellation',
  name: 'Generate Tessellation',
  category: CAT,
  description:
    'Covers the extent of a layer with a regular grid of squares, hexagons or triangles of a given size. Use it for fishnets, sampling grids or as the bins for your own summaries.',
  keywords: ['grid', 'fishnet', 'hexagon', 'square', 'triangle', 'bins', 'mesh'],
  outputPrefix: 'Tessellation',
  params: [
    layerP('extent', 'Extent layer', { help: 'The grid covers the extent of this layer (selected features only, if any are selected).', geom: ANY_GEOM }),
    choiceP('shape', 'Shape', 'hexagon', [['square', 'Square'], ['hexagon', 'Hexagon'], ['triangle', 'Triangle']], { help: 'Shape of the cells.' }),
    distP('size', 'Cell size (side length)', { value: 10, unit: 'km' }, { help: 'Length of one side of a cell.', min: 0 }),
    boolP('onlyIntersecting', 'Only cells touching features', false, { help: 'Drop cells that do not touch any feature of the extent layer.' }),
    outP(),
  ],
  run(ctx) {
    const L = ctx.layer('extent');
    const sizeM = toMeters(ctx.params.size);
    if (!(sizeM > 0)) throw new ToolError('The cell size must be greater than zero.');
    const box = layerBBox(L);
    if (!box) throw new ToolError('The extent layer has no geometry.');
    const shape = String(ctx.params.shape);
    const wM = haversine([box[0], box[1]], [box[2], box[1]]) + sizeM, hM = haversine([box[0], box[1]], [box[0], box[3]]) + sizeM;
    const area = shape === 'hexagon' ? 2.6 : shape === 'triangle' ? 0.433 : 1;
    const est = (wM * hM) / (sizeM * sizeM * area);
    if (est > 200000) throw new ToolError(`That would create about ${Math.round(est).toLocaleString()} cells. Choose a larger cell size.`);
    const b = gridBox(box, sizeM, shape);
    const opts = { units: 'kilometers' as const };
    const fc: any = shape === 'square' ? turf.squareGrid(b, sizeM / 1000, opts) : shape === 'triangle' ? turf.triangleGrid(b, sizeM / 1000, opts) : turf.hexGrid(b, sizeM / 1000, opts);
    let cells: Geometry[] = (fc.features as any[]).map((f) => f.geometry as Geometry);
    if (ctx.params.onlyIntersecting) {
      const { index } = indexLayer(L.features);
      cells = cells.filter((c) => index.query(bboxOf(c)!).some((k) => L.features[k].geometry && intersectsGeom(c, L.features[k].geometry!)));
    }
    ctx.message(`${cells.length.toLocaleString()} ${shape} cells created.`);
    return buildResult(
      cells.map((g, i) => mkFeature(g, { GRID_ID: i + 1 })),
      { geomType: 'Polygon', fields: [{ name: 'GRID_ID', type: 'integer' }] },
    );
  },
};

// ---------- Create Random Points ----------

export const randomPoints: ToolDef = {
  id: 'create-random-points',
  name: 'Create Random Points',
  category: CAT,
  description:
    'Scatters random points inside the polygons of a layer or inside its bounding extent. Points can be spread over all polygons in proportion to their area, or a fixed number placed in each polygon. An optional minimum distance keeps points apart.',
  keywords: ['sample', 'random', 'scatter', 'sampling', 'monte carlo'],
  outputPrefix: 'RandomPoints',
  params: [
    layerP('constraint', 'Constraining layer', { help: 'Polygons to place points in, or any layer whose extent is used.', geom: ANY_GEOM }),
    choiceP('mode', 'Place points', 'polygons', [['polygons', 'Inside the polygons'], ['extent', 'Inside the layer extent']], { help: 'Polygon mode needs a polygon layer.' }),
    numP('count', 'Number of points', 100, { help: 'Total points, or points per polygon when "Per polygon" is on.', min: 1, max: 1000000, integer: true }),
    boolP('perFeature', 'Per polygon', false, { help: 'Create the given number of points in every polygon instead of in total.', showIf: (v) => v.mode !== 'extent' }),
    distP('minDistance', 'Minimum distance', { value: 0, unit: 'm' }, { help: 'Smallest allowed spacing between points. 0 for none.', min: 0 }),
    numP('seed', 'Random seed', 0, { help: 'Use the same non-zero seed to reproduce the same points. 0 gives a different result every run.', min: 0, integer: true }),
    outP(),
  ],
  run(ctx) {
    const L = ctx.layer('constraint');
    const total = Math.max(1, Math.round(Number(ctx.params.count) || 1));
    const minD = toMeters(ctx.params.minDistance);
    const seed = Math.round(Number(ctx.params.seed)) || Math.floor(Math.random() * 2 ** 31);
    const rnd = mulberry32(seed);
    type Zone = { polys: number[][][][]; box: BBox; area: number; fid: number | string | null };
    let zones: Zone[];
    if (ctx.params.mode === 'extent') {
      const b = layerBBox(L);
      if (!b) throw new ToolError('The layer has no geometry.');
      zones = [{ polys: [], box: b, area: 1, fid: null }];
    } else {
      if (L.geomType !== 'Polygon') throw new ToolError('Choose a polygon layer, or switch to "Inside the layer extent".');
      zones = L.features
        .map((f, i) => ({ polys: polygonsOf(f.geometry), box: bboxOf(f.geometry)!, area: geomAreaM2(f.geometry), fid: f.id ?? i + 1 }))
        .filter((z) => z.polys.length && z.area > 0);
      if (!zones.length) throw new ToolError('The polygons have no area.');
    }
    const perZone = !!ctx.params.perFeature && ctx.params.mode !== 'extent';
    const totalArea = zones.reduce((s, z) => s + z.area, 0);
    const targets = zones.map((z) => (perZone ? total : 0));
    if (!perZone) {
      // Distribute the total over zones proportionally to area (largest remainder).
      const raw = zones.map((z) => (z.area / totalArea) * total);
      raw.forEach((r, i) => (targets[i] = Math.floor(r)));
      let left = total - targets.reduce((a, b) => a + b, 0);
      raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => targets[i]++);
      left = 0;
    }
    const hash = new Map<string, Pos[]>();
    const cell = minD > 0 ? minD : 0;
    const keyOf = (p: Pos) => `${Math.floor((p[0] * M_PER_DEG * Math.cos(p[1] * RAD)) / cell)},${Math.floor((p[1] * M_PER_DEG) / cell)}`;
    const tooClose = (p: Pos): boolean => {
      if (!cell) return false;
      const gx = Math.floor((p[0] * M_PER_DEG * Math.cos(p[1] * RAD)) / cell), gy = Math.floor((p[1] * M_PER_DEG) / cell);
      for (let x = gx - 1; x <= gx + 1; x++)
        for (let y = gy - 1; y <= gy + 1; y++) for (const q of hash.get(`${x},${y}`) ?? []) if (haversine(p, q) < minD) return true;
      return false;
    };
    const out: GpFeature[] = [];
    const tick = ticker(ctx, zones.length, 'Filling polygon');
    let failed = 0;
    zones.forEach((z, zi) => {
      tick(zi);
      const sMin = Math.sin(z.box[1] * RAD), sMax = Math.sin(z.box[3] * RAD);
      let made = 0, attempts = 0;
      const maxAttempts = targets[zi] * 300 + 1000;
      while (made < targets[zi] && attempts++ < maxAttempts) {
        const lon = z.box[0] + rnd() * (z.box[2] - z.box[0]);
        const lat = Math.asin(sMin + rnd() * (sMax - sMin)) / RAD;
        const p: Pos = [lon, lat];
        if (z.polys.length && !pointInPolys(p, z.polys)) continue;
        if (tooClose(p)) continue;
        if (cell) {
          const k = keyOf(p);
          const arr = hash.get(k);
          if (arr) arr.push(p);
          else hash.set(k, [p]);
        }
        made++;
        out.push(mkFeature({ type: 'Point', coordinates: p }, { Point_ID: out.length + 1, Source_FID: z.fid }));
      }
      failed += targets[zi] - made;
    });
    if (failed > 0) ctx.message(`${failed.toLocaleString()} points could not be placed (minimum distance too large for the area).`, 'warning');
    ctx.message(`${out.length.toLocaleString()} random points created (seed ${seed}).`);
    return buildResult(out, { geomType: 'Point', fields: [{ name: 'Point_ID', type: 'integer' }, { name: 'Source_FID', type: 'integer' }] });
  },
};

// ---------- XY To Line ----------

export function initialBearing(a: Pos, b: Pos): number {
  const f1 = a[1] * RAD, f2 = b[1] * RAD, dl = (b[0] - a[0]) * RAD;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}
export function destinationPoint(p: Pos, bearingDeg: number, distM: number): Pos {
  const f1 = p[1] * RAD, l1 = p[0] * RAD, th = bearingDeg * RAD, d = distM / R;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [((((l2 / RAD) + 540) % 360) - 180), f2 / RAD];
}

/** Great-circle path between two points, split where it crosses the antimeridian. */
export function greatCircleLine(a: Pos, b: Pos, n = 48): Geometry {
  const pts: Pos[] = [];
  for (let i = 0; i <= n; i++) pts.push(i === 0 ? a : i === n ? b : gcInterp(a, b, i / n));
  const parts: Pos[][] = [[pts[0]]];
  for (let i = 1; i < pts.length; i++) {
    if (Math.abs(pts[i][0] - pts[i - 1][0]) > 180) {
      const west = pts[i - 1][0] < pts[i][0];
      const lat = (pts[i - 1][1] + pts[i][1]) / 2;
      parts[parts.length - 1].push([west ? -180 : 180, lat]);
      parts.push([[west ? 180 : -180, lat]]);
    }
    parts[parts.length - 1].push(pts[i]);
  }
  return parts.length === 1 ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts };
}

const num = (v: any): number | null => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export const xyToLine: ToolDef = {
  id: 'xy-to-line',
  name: 'XY To Line',
  category: CAT,
  description:
    'Creates a line for each row of a table from origin and destination coordinates (longitude/latitude fields). Lines can follow the great circle (geodesic) or be straight in lon/lat space. Adds Length_km and the initial Bearing.',
  keywords: ['origin destination', 'od', 'flow', 'great circle', 'geodesic', 'connect', 'route lines'],
  outputPrefix: 'Lines',
  params: [
    layerP('input', 'Input table', { help: 'A table or layer with origin and destination coordinates in fields.', geom: ANY_OR_TABLE }),
    fieldP('x1', 'Origin X (lon)', 'input', { help: 'Field with the origin longitude.', types: NUMERIC }),
    fieldP('y1', 'Origin Y (lat)', 'input', { help: 'Field with the origin latitude.', types: NUMERIC }),
    fieldP('x2', 'Destination X (lon)', 'input', { help: 'Field with the destination longitude.', types: NUMERIC }),
    fieldP('y2', 'Destination Y (lat)', 'input', { help: 'Field with the destination latitude.', types: NUMERIC }),
    choiceP('type', 'Line type', 'geodesic', [['geodesic', 'Geodesic (great circle)'], ['straight', 'Straight in lon/lat']], { help: 'Geodesic lines are the shortest path on the globe.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const { x1, y1, x2, y2 } = ctx.params;
    const taken = input.fields.map((f) => f.name);
    const lenName = uniqueName('Length_km', taken), brgName = uniqueName('Bearing', [...taken, lenName]);
    const out: GpFeature[] = [];
    let skipped = 0;
    for (const f of input.features) {
      const v = [x1, y1, x2, y2].map((n) => num(f.properties[n]));
      if (v.some((n) => n === null) || Math.abs(v[1]!) > 90 || Math.abs(v[3]!) > 90) {
        skipped++;
        continue;
      }
      const a: Pos = [v[0]!, v[1]!], b: Pos = [v[2]!, v[3]!];
      if (a[0] === b[0] && a[1] === b[1]) {
        skipped++;
        continue;
      }
      const g: Geometry = ctx.params.type === 'straight' ? { type: 'LineString', coordinates: [a, b] } : greatCircleLine(a, b);
      out.push(mkFeature(g, { ...f.properties, [lenName]: haversine(a, b) / 1000, [brgName]: initialBearing(a, b) }, f.id));
    }
    warnIfSkipped(ctx, skipped, 'rows with missing, identical or invalid coordinates');
    return buildResult(out, { geomType: 'LineString', fields: [...input.fields, { name: lenName, type: 'number' }, { name: brgName, type: 'number' }] });
  },
};

// ---------- Bearing Distance To Line ----------

export const bearingDistanceToLine: ToolDef = {
  id: 'bearing-distance-to-line',
  name: 'Bearing Distance To Line',
  category: CAT,
  description:
    'Draws a geodesic line from each origin along a bearing (degrees clockwise from north) for a distance. Origins come from point geometry or from X/Y fields; bearing and distance can come from fields or be fixed values. Adds the destination coordinates.',
  keywords: ['azimuth', 'direction', 'heading', 'ray', 'vector', 'survey', 'traverse'],
  outputPrefix: 'BearingLines',
  params: [
    layerP('input', 'Input points or table', { help: 'Point layer, or a table with origin coordinate fields.', geom: ['Point', 'Table'] }),
    fieldP('x', 'Origin X (lon)', 'input', { help: 'Optional. Leave empty to use the point geometry.', optional: true, allowNone: true, types: NUMERIC }),
    fieldP('y', 'Origin Y (lat)', 'input', { help: 'Optional. Leave empty to use the point geometry.', optional: true, allowNone: true, types: NUMERIC }),
    fieldP('bearingField', 'Bearing field', 'input', { help: 'Optional field with the bearing in degrees. Empty uses the fixed bearing.', optional: true, allowNone: true, types: NUMERIC }),
    numP('bearing', 'Fixed bearing', 0, { help: 'Bearing in degrees clockwise from north, used when no bearing field is chosen.', min: -360, max: 360 }),
    fieldP('distanceField', 'Distance field', 'input', { help: 'Optional field with the distance. Empty uses the fixed distance. Values use the unit below.', optional: true, allowNone: true, types: NUMERIC }),
    distP('distance', 'Fixed distance / unit', { value: 10, unit: 'km' }, { help: 'Distance used when no distance field is chosen; its unit also applies to the distance field.', min: 0 }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const p = ctx.params;
    const unit = toMeters({ value: 1, unit: p.distance.unit });
    const taken = input.fields.map((f) => f.name);
    const bName = uniqueName('Bearing', taken), dName = uniqueName('Distance_m', [...taken, bName]);
    const xName = uniqueName('End_X', [...taken, bName, dName]), yName = uniqueName('End_Y', [...taken, bName, dName, xName]);
    const out: GpFeature[] = [];
    let skipped = 0;
    for (const f of input.features) {
      let o: Pos | null = null;
      if (p.x && p.y) {
        const x = num(f.properties[p.x]), y = num(f.properties[p.y]);
        if (x !== null && y !== null) o = [x, y];
      } else if (f.geometry?.type === 'Point') o = f.geometry.coordinates;
      else if (f.geometry?.type === 'MultiPoint') o = f.geometry.coordinates[0] ?? null;
      const brg = p.bearingField ? num(f.properties[p.bearingField]) : Number(p.bearing);
      const dist = p.distanceField ? (num(f.properties[p.distanceField]) ?? NaN) * unit : toMeters(p.distance);
      if (!o || brg === null || !(dist > 0) || Math.abs(o[1]) > 90) {
        skipped++;
        continue;
      }
      const end = destinationPoint(o, brg, dist);
      out.push(mkFeature(greatCircleLine(o, end, 32), { ...f.properties, [bName]: brg, [dName]: dist, [xName]: end[0], [yName]: end[1] }, f.id));
    }
    warnIfSkipped(ctx, skipped, 'rows with a missing origin, bearing or distance');
    const fields: Field[] = [...input.fields, { name: bName, type: 'number' }, { name: dName, type: 'number' }, { name: xName, type: 'number' }, { name: yName, type: 'number' }];
    return buildResult(out, { geomType: 'LineString', fields });
  },
};

export const GENERATE_TOOLS: ToolDef[] = [tessellation, randomPoints, xyToLine, bearingDistanceToLine];
