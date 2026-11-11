// Density & surface tools: Kernel Density, IDW Interpolation, Aggregate Points (bins).
import * as turf from '@turf/turf';
import type { Geometry } from 'geojson';
import {
  GridIndex, M_PER_DEG, RAD, bboxOf, bboxUnion, buildResult, cleanStats, expandBoxM, layerBBox, mkFeature, pointInPoly, pointsOf, polygonsOf, statFields, statValues, toMeters,
  uniqueName, haversine, type BBox,
} from '../geo';
import { NUMERIC, POINT, POLY, boolP, choiceP, distP, fieldP, layerP, numP, outP } from '../params';
import { ToolError, type Field, type GpFeature, type ToolContext, type ToolDef } from '../types';
import { gridBox, ticker } from './common';

const CAT = 'Density & Surfaces';
const MAX_CELLS = 250000;

interface Grid {
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  dx: number;
  dy: number;
  cellM: number;
  v: Float64Array;
}

function makeGrid(box: BBox, cellM: number, ctx: ToolContext): Grid {
  const midLat = (box[1] + box[3]) / 2;
  const kx = Math.max(0.05, Math.cos(midLat * RAD));
  let cell = cellM;
  const build = () => {
    const dx = cell / (M_PER_DEG * kx), dy = cell / M_PER_DEG;
    const cols = Math.ceil((box[2] - box[0]) / dx) + 1, rows = Math.ceil((box[3] - box[1]) / dy) + 1;
    return { dx, dy, cols, rows };
  };
  let g = build();
  if (g.cols * g.rows > MAX_CELLS) {
    cell *= Math.sqrt((g.cols * g.rows) / MAX_CELLS) * 1.02;
    ctx.message(`The cell size was increased to ${Math.round(cell).toLocaleString()} m to keep the grid under ${MAX_CELLS.toLocaleString()} cells.`, 'warning');
    g = build();
  }
  return { ...g, x0: box[0], y0: box[1], cellM: cell, v: new Float64Array(g.cols * g.rows) };
}

function bandsFromGrid(grid: Grid, breaks: number[], zero = 0): Geometry[] {
  const pts: any[] = [];
  for (let r = 0; r < grid.rows; r++) {
    const lat = grid.y0 + r * grid.dy;
    for (let c = 0; c < grid.cols; c++) pts.push({ type: 'Feature', properties: { v: grid.v[r * grid.cols + c] || zero }, geometry: { type: 'Point', coordinates: [grid.x0 + c * grid.dx, lat] } });
  }
  const bands = turf.isobands({ type: 'FeatureCollection', features: pts } as any, breaks, {
    zProperty: 'v',
    breaksProperties: breaks.slice(0, -1).map((_, i) => ({ band: i })),
  });
  const out: Geometry[] = [];
  const byBand = new Map<number, Geometry>();
  for (const f of bands.features) if (f.geometry && polygonsOf(f.geometry as Geometry).length) byBand.set((f.properties as any).band, f.geometry as Geometry);
  for (let i = 0; i < breaks.length - 1; i++) out[i] = byBand.get(i) as Geometry;
  return out;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 1 ? n.toFixed(2) : n.toPrecision(2));

// ---------- Kernel Density ----------

export const kernelDensity: ToolDef = {
  id: 'kernel-density',
  name: 'Kernel Density',
  category: CAT,
  description:
    'Turns points into a smooth density surface (quartic kernel, points per square kilometre) and outputs it as filled contour polygons, from the lowest density to the hot spots. The search radius controls how far each point spreads; a numeric weight field can count some points more than others.',
  keywords: ['heat map', 'hotspot', 'density', 'smooth', 'contours', 'concentration'],
  outputPrefix: 'Density',
  params: [
    layerP('input', 'Input points', { help: 'Point features.', geom: POINT }),
    fieldP('weight', 'Weight field', 'input', { help: 'Optional numeric field giving each point\'s weight (e.g. population). Empty counts every point as 1.', optional: true, allowNone: true, types: NUMERIC }),
    distP('radius', 'Search radius', { value: 0, unit: 'km' }, { help: 'Distance over which each point spreads its weight. 0 picks a radius from the point extent.', min: 0 }),
    distP('cell', 'Cell size', { value: 0, unit: 'km' }, { help: 'Resolution of the working grid. 0 uses a quarter of the radius.', min: 0 }),
    numP('classes', 'Number of classes', 8, { help: 'How many density bands to create.', min: 2, max: 20, integer: true }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const wf: string = ctx.params.weight || '';
    const pts: Array<{ p: number[]; w: number }> = [];
    for (const f of input.features) {
      const w = wf ? Number(f.properties[wf]) : 1;
      if (!Number.isFinite(w) || (wf && f.properties[wf] == null)) continue;
      for (const p of pointsOf(f.geometry)) pts.push({ p, w });
    }
    if (pts.length < 1) throw new ToolError('The input has no points with a valid weight.');
    const box = bboxUnion(pts.map((x) => [x.p[0], x.p[1], x.p[0], x.p[1]] as BBox))!;
    const wM = haversine([box[0], (box[1] + box[3]) / 2], [box[2], (box[1] + box[3]) / 2]), hM = haversine([box[0], box[1]], [box[0], box[3]]);
    let radius = toMeters(ctx.params.radius);
    if (!(radius > 0)) radius = Math.max(100, (Math.min(wM, hM) || Math.max(wM, hM)) / 30);
    let cellM = toMeters(ctx.params.cell);
    if (!(cellM > 0)) cellM = radius / 4;
    const grid = makeGrid(expandBoxM(box, radius + cellM * 2), cellM, ctx);
    const midLat = grid.y0 + (grid.rows * grid.dy) / 2;
    const kx = M_PER_DEG * Math.max(0.05, Math.cos(midLat * RAD));
    const cx = grid.dx * kx; // cell width (m)
    const cy = grid.dy * M_PER_DEG;
    const rcx = Math.ceil(radius / cx), rcy = Math.ceil(radius / cy);
    const K = 3 / (Math.PI * radius * radius);
    const tick = ticker(ctx, pts.length, 'Spreading point');
    pts.forEach(({ p, w }, n) => {
      tick(n);
      const ci = Math.round((p[0] - grid.x0) / grid.dx), ri = Math.round((p[1] - grid.y0) / grid.dy);
      for (let r = Math.max(0, ri - rcy); r <= Math.min(grid.rows - 1, ri + rcy); r++) {
        const dyM = (grid.y0 + r * grid.dy - p[1]) * M_PER_DEG;
        for (let c = Math.max(0, ci - rcx); c <= Math.min(grid.cols - 1, ci + rcx); c++) {
          const dxM = (grid.x0 + c * grid.dx - p[0]) * kx;
          const d2 = (dxM * dxM + dyM * dyM) / (radius * radius);
          if (d2 < 1) grid.v[r * grid.cols + c] += w * K * (1 - d2) * (1 - d2) * 1e6;
        }
      }
    });
    let max = 0;
    for (const v of grid.v) if (v > max) max = v;
    if (!(max > 0)) throw new ToolError('The density surface is empty; try a larger search radius.');
    const classes = Math.max(2, Math.round(Number(ctx.params.classes) || 8));
    const breaks = [max * 0.001, ...Array.from({ length: classes }, (_, i) => (max * (i + 1)) / classes)];
    breaks[breaks.length - 1] = max * 1.0001;
    ctx.progress(0.9, 'Contouring');
    const geoms = bandsFromGrid(grid, breaks);
    const out: GpFeature[] = [];
    geoms.forEach((g, i) => {
      if (!g) return;
      out.push(mkFeature(g, { Class: i + 1, Min_Density: breaks[i], Max_Density: breaks[i + 1], Label: `${fmt(breaks[i])} - ${fmt(breaks[i + 1])}` }));
    });
    ctx.message(`Search radius ${Math.round(radius).toLocaleString()} m, cell size ${Math.round(grid.cellM).toLocaleString()} m, peak density ${fmt(max)} per km2.`);
    return buildResult(out, {
      geomType: 'Polygon',
      fields: [{ name: 'Class', type: 'integer' }, { name: 'Min_Density', type: 'number' }, { name: 'Max_Density', type: 'number' }, { name: 'Label', type: 'string' }],
    });
  },
};

// ---------- IDW ----------

export const idw: ToolDef = {
  id: 'idw-interpolation',
  name: 'IDW Interpolation',
  category: CAT,
  description:
    'Estimates a continuous surface from measured points with inverse distance weighting: nearby points influence a location more than distant ones. The surface is returned as filled contour polygons (equal-interval bands of the estimated value).',
  keywords: ['interpolate', 'surface', 'inverse distance', 'contours', 'temperature', 'elevation'],
  outputPrefix: 'IDW',
  params: [
    layerP('input', 'Input points', { help: 'Point features with a numeric measurement.', geom: POINT }),
    fieldP('field', 'Value field', 'input', { help: 'Numeric field to interpolate.', types: NUMERIC }),
    distP('cell', 'Cell size', { value: 0, unit: 'km' }, { help: 'Resolution of the working grid. 0 picks about 100 cells across the extent.', min: 0 }),
    numP('power', 'Power', 2, { help: 'Higher powers give nearby points more influence.', min: 0.5, max: 8, step: 0.5 }),
    numP('neighbors', 'Neighbours', 12, { help: 'Number of nearest points used for each cell.', min: 1, max: 100, integer: true }),
    distP('radius', 'Search radius', { value: 0, unit: 'km' }, { help: 'Ignore points farther away than this. 0 means no limit.', min: 0 }),
    numP('classes', 'Number of classes', 8, { help: 'How many value bands to create.', min: 2, max: 20, integer: true }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const f: string = ctx.params.field;
    const pts: Array<{ x: number; y: number; z: number }> = [];
    for (const feat of input.features) {
      const z = feat.properties[f];
      if (z == null || z === '' || !Number.isFinite(Number(z))) continue;
      for (const p of pointsOf(feat.geometry)) pts.push({ x: p[0], y: p[1], z: Number(z) });
    }
    if (pts.length < 3) throw new ToolError('At least three points with a numeric value are needed.');
    const zs = pts.map((p) => p.z);
    const zmin = Math.min(...zs), zmax = Math.max(...zs);
    if (zmin === zmax) throw new ToolError('All points have the same value, so there is nothing to interpolate.');
    const box0 = bboxUnion(pts.map((p) => [p.x, p.y, p.x, p.y] as BBox))!;
    const wM = haversine([box0[0], (box0[1] + box0[3]) / 2], [box0[2], (box0[1] + box0[3]) / 2]), hM = haversine([box0[0], box0[1]], [box0[0], box0[3]]);
    let cellM = toMeters(ctx.params.cell);
    if (!(cellM > 0)) cellM = Math.max(10, Math.max(wM, hM) / 100);
    const padX = Math.max((box0[2] - box0[0]) * 0.05, 1e-5), padY = Math.max((box0[3] - box0[1]) * 0.05, 1e-5);
    const grid = makeGrid([box0[0] - padX, box0[1] - padY, box0[2] + padX, box0[3] + padY], cellM, ctx);
    const power = Number(ctx.params.power) || 2;
    const k = Math.max(1, Math.round(Number(ctx.params.neighbors) || 12));
    const rad = toMeters(ctx.params.radius);
    if (grid.cols * grid.rows * pts.length > 4e8) throw new ToolError('Too many points for this grid size; choose a larger cell size.');
    const index = new GridIndex(pts.map((p) => [p.x, p.y, p.x, p.y] as BBox));
    const tick = ticker(ctx, grid.rows, 'Interpolating row');
    const dists = new Float64Array(pts.length);
    const order: number[] = [];
    for (let r = 0; r < grid.rows; r++) {
      tick(r);
      const lat = grid.y0 + r * grid.dy;
      const kx = M_PER_DEG * Math.max(0.05, Math.cos(lat * RAD));
      for (let c = 0; c < grid.cols; c++) {
        const lon = grid.x0 + c * grid.dx;
        let cands: number[];
        if (rad > 0) cands = index.query(expandBoxM([lon, lat, lon, lat], rad));
        else {
          cands = order;
          if (!order.length) for (let i = 0; i < pts.length; i++) order.push(i);
        }
        let n = 0;
        const list: number[] = [];
        for (const i of cands) {
          const d = Math.hypot((pts[i].x - lon) * kx, (pts[i].y - lat) * M_PER_DEG);
          if (rad > 0 && d > rad) continue;
          dists[i] = d;
          list.push(i);
          n++;
        }
        if (!n) {
          grid.v[r * grid.cols + c] = zmin;
          continue;
        }
        const use = n > k ? list.sort((a, b) => dists[a] - dists[b]).slice(0, k) : list;
        let num = 0, den = 0, exact: number | null = null;
        for (const i of use) {
          const d = dists[i];
          if (d < 1e-6) {
            exact = pts[i].z;
            break;
          }
          const w = 1 / Math.pow(d, power);
          num += w * pts[i].z;
          den += w;
        }
        grid.v[r * grid.cols + c] = exact ?? num / den;
      }
    }
    const classes = Math.max(2, Math.round(Number(ctx.params.classes) || 8));
    const span = zmax - zmin;
    const breaks = Array.from({ length: classes + 1 }, (_, i) => zmin + (span * i) / classes);
    breaks[0] = zmin - span * 1e-6;
    breaks[classes] = zmax + span * 1e-6;
    ctx.progress(0.95, 'Contouring');
    const geoms = bandsFromGrid(grid, breaks, 0);
    const out: GpFeature[] = [];
    geoms.forEach((g, i) => {
      if (!g) return;
      const lo = Math.max(zmin, breaks[i]), hi = Math.min(zmax, breaks[i + 1]);
      out.push(mkFeature(g, { Class: i + 1, Min_Value: lo, Max_Value: hi, Label: `${fmt(lo)} - ${fmt(hi)}` }));
    });
    ctx.message(`Interpolated ${pts.length.toLocaleString()} points on a ${grid.cols} x ${grid.rows} grid (cell ${Math.round(grid.cellM).toLocaleString()} m).`);
    return buildResult(out, {
      geomType: 'Polygon',
      fields: [{ name: 'Class', type: 'integer' }, { name: 'Min_Value', type: 'number' }, { name: 'Max_Value', type: 'number' }, { name: 'Label', type: 'string' }],
    });
  },
};

// ---------- Aggregate Points ----------

export const aggregatePoints: ToolDef = {
  id: 'aggregate-points',
  name: 'Aggregate Points (Bins)',
  category: CAT,
  description:
    'Counts points in a regular grid of hexagons or squares and writes one polygon per bin with its Point_Count and, optionally, a statistic of a numeric field. Bins make dense point data readable as a choropleth.',
  keywords: ['hexbin', 'hex bins', 'grid', 'count', 'bin', 'aggregate', 'fishnet'],
  outputPrefix: 'Bins',
  params: [
    layerP('input', 'Input points', { help: 'Point features.', geom: POINT }),
    choiceP('shape', 'Bin shape', 'hexagon', [['hexagon', 'Hexagon'], ['square', 'Square']], { help: 'Shape of the bins.' }),
    distP('size', 'Bin size (side length)', { value: 10, unit: 'km' }, { help: 'Length of one side of a bin.', min: 0 }),
    fieldP('field', 'Summarize field', 'input', { help: 'Optional numeric field to summarise in each bin.', optional: true, allowNone: true, types: NUMERIC }),
    choiceP('stat', 'Statistic', 'sum', [['sum', 'Sum'], ['mean', 'Mean'], ['min', 'Minimum'], ['max', 'Maximum']], { help: 'How the field values are combined.', showIf: (v) => !!v.field }),
    boolP('keepEmpty', 'Keep empty bins', false, { help: 'Also output bins that contain no points.' }),
    outP(),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const sizeM = toMeters(ctx.params.size);
    if (!(sizeM > 0)) throw new ToolError('The bin size must be greater than zero.');
    const box = layerBBox(input);
    if (!box) throw new ToolError('The input has no points.');
    const hex = ctx.params.shape !== 'square';
    const wM = haversine([box[0], box[1]], [box[2], box[1]]) + 2 * sizeM, hM = haversine([box[0], box[1]], [box[0], box[3]]) + 2 * sizeM;
    const est = (wM * hM) / (sizeM * sizeM * (hex ? 2.6 : 1));
    if (est > 150000) throw new ToolError(`That would create about ${Math.round(est).toLocaleString()} bins. Choose a larger bin size.`);
    const grow = gridBox(box, sizeM, hex ? 'hexagon' : 'square');
    const fc: any = hex
      ? turf.hexGrid(grow, sizeM / 1000, { units: 'kilometers' })
      : turf.squareGrid(grow, sizeM / 1000, { units: 'kilometers' });
    const cells = (fc.features as any[]).map((f) => ({ g: f.geometry as Geometry, poly: f.geometry.coordinates as number[][][] }));
    const boxes = cells.map((c) => bboxOf(c.g));
    const index = new GridIndex(boxes);
    const hits: GpFeature[][] = cells.map(() => []);
    const tick = ticker(ctx, input.features.length, 'Binning point');
    input.features.forEach((f, i) => {
      tick(i);
      for (const p of pointsOf(f.geometry)) {
        for (const k of index.query([p[0], p[1], p[0], p[1]])) {
          if (pointInPoly(p, cells[k].poly)) {
            hits[k].push(f);
            break;
          }
        }
      }
    });
    const field: string = ctx.params.field || '';
    const stat = ['mean', 'min', 'max'].includes(ctx.params.stat) ? ctx.params.stat : 'sum';
    const specs = field ? cleanStats([{ field, stat }], input) : [];
    const sf: Field[] = statFields(specs, input.fields);
    const out: GpFeature[] = [];
    cells.forEach((c, i) => {
      if (!hits[i].length && !ctx.params.keepEmpty) return;
      out.push(mkFeature(c.g, { Bin_ID: out.length + 1, Point_Count: hits[i].length, ...statValues(specs, hits[i]) }));
    });
    ctx.message(`${out.length.toLocaleString()} bins contain data; the fullest bin holds ${Math.max(0, ...hits.map((h) => h.length)).toLocaleString()} points.`);
    return buildResult(out, {
      geomType: 'Polygon',
      fields: [{ name: 'Bin_ID', type: 'integer' }, { name: 'Point_Count', type: 'integer' }, ...sf],
    });
  },
};

export const SURFACE_TOOLS: ToolDef[] = [kernelDensity, idw, aggregatePoints];
