// Helpers shared by the tool implementations.
import type { Geometry } from 'geojson';
import {
  GridIndex, asPolygonal, bboxOf, coordsOf, edgeLinesOf, geomAreaM2, geomDistM, mkFeature, pointInPolys, polygonsOf, pointsOf, Mask, differencePolys, linesOf,
  segIntersect, haversine, pointSegDistM, expandBoxM, type BBox,
} from '../geo';
import type { Field, GpFeature, LayerData, ToolContext } from '../types';

export const AREA_UNITS: Array<[string, string]> = [
  ['km2', 'Square kilometers'], ['ha', 'Hectares'], ['m2', 'Square meters'], ['ac', 'Acres'], ['mi2', 'Square miles'], ['ft2', 'Square feet'],
];
export const AREA_M2: Record<string, number> = { m2: 1, km2: 1e6, ha: 1e4, ac: 4046.8564224, mi2: 2589988.110336, ft2: 0.09290304 };
export const AREA_LABEL: Record<string, string> = { m2: 'm2', km2: 'km2', ha: 'ha', ac: 'ac', mi2: 'mi2', ft2: 'ft2' };
export const LENGTH_UNITS: Array<[string, string]> = [['km', 'Kilometers'], ['m', 'Meters'], ['mi', 'Miles'], ['ft', 'Feet']];
export const LENGTH_M: Record<string, number> = { m: 1, km: 1000, ft: 0.3048, mi: 1609.344 };

/** Report progress at most ~50 times. */
export function ticker(ctx: ToolContext, total: number, label: string) {
  const step = Math.max(1, Math.floor(total / 50));
  return (i: number) => {
    if (i % step === 0) ctx.progress(total ? i / total : 1, `${label} ${i.toLocaleString()} of ${total.toLocaleString()}`);
  };
}

/** turf's hex and triangle grids leave a ragged fringe, so grow the box until the data is fully covered. */
export function gridBox(box: BBox, sizeM: number, shape: string): BBox {
  return expandBoxM(box, sizeM * (shape === 'square' ? 1.2 : 1.5));
}

export const withGeom =(l: LayerData) => l.features.filter((f) => f.geometry && coordsOf(f.geometry).length);

export function warnIfSkipped(ctx: ToolContext, skipped: number, what: string) {
  if (skipped > 0) ctx.message(`${skipped.toLocaleString()} ${what} skipped.`, 'warning');
}

export function indexLayer(features: GpFeature[]) {
  const boxes = features.map((f) => bboxOf(f.geometry));
  return { boxes, index: new GridIndex(boxes) };
}

export function layerMask(l: LayerData): Mask {
  const polys = l.features.flatMap((f) => polygonsOf(f.geometry));
  return new Mask({ type: 'MultiPolygon', coordinates: polys });
}

export const fieldType = (l: LayerData, name: string) => l.fields.find((f) => f.name === name)?.type ?? 'string';

// ---------- predicates between arbitrary geometries ----------

function lineOnLine(a: Geometry, b: Geometry): boolean {
  const la = edgeLinesOf(a), lb = edgeLinesOf(b);
  for (const p of coordsOf(a)) {
    let ok = false;
    for (const l of lb) {
      for (let i = 1; i < l.length && !ok; i++) ok = pointSegDistM(p, l[i - 1], l[i]) < 0.05;
      if (ok) break;
    }
    if (!ok) return false;
  }
  return la.length > 0;
}

export function withinGeom(a: Geometry, b: Geometry): boolean {
  const polysB = polygonsOf(b);
  const fa = a.type === 'GeometryCollection' ? null : a;
  if (!fa) return false;
  if (!polysB.length) {
    const pa = pointsOf(a);
    if (pa.length && !edgeLinesOf(a).length) {
      const lb = edgeLinesOf(b);
      const ptsB = pointsOf(b);
      return pa.every((p) => ptsB.some((q) => haversine(p, q) < 0.05) || lb.some((l) => l.some((_, i) => i > 0 && pointSegDistM(p, l[i - 1], l[i]) < 0.05)));
    }
    return lineOnLine(a, b);
  }
  const pa = pointsOf(a);
  if (pa.length) return pa.every((p) => pointInPolys(p, polysB));
  if (polygonsOf(a).length) {
    const pg = asPolygonal(a)!;
    const d = differencePolys(pg, [b]);
    if (!d) return true;
    const ra = geomAreaM2(pg);
    return geomAreaM2(d) <= ra * 1e-6;
  }
  const mask = new Mask(b);
  for (const line of linesOf(a)) {
    for (let i = 0; i < line.length; i++) if (!mask.contains(line[i]) && !onBoundary(line[i], polysB)) return false;
    for (let i = 1; i < line.length; i++) {
      const ts = mask.crossings(line[i - 1], line[i]);
      const cuts = [0, ...ts, 1];
      for (let k = 1; k < cuts.length; k++) {
        const t = (cuts[k - 1] + cuts[k]) / 2;
        if (!mask.contains([line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t])) return false;
      }
    }
  }
  return true;
}
function onBoundary(p: number[], polys: number[][][][]): boolean {
  for (const poly of polys) for (const ring of poly) for (let i = 1; i < ring.length; i++) if (pointSegDistM(p, ring[i - 1], ring[i]) < 0.05) return true;
  return false;
}

export function intersectsGeom(a: Geometry, b: Geometry): boolean {
  const pb = polygonsOf(b), pa = polygonsOf(a);
  const ptsA = pointsOf(a), ptsB = pointsOf(b);
  if (ptsA.length && !edgeLinesOf(a).length && pb.length) return ptsA.some((p) => pointInPolys(p, pb));
  if (ptsB.length && !edgeLinesOf(b).length && pa.length) return ptsB.some((p) => pointInPolys(p, pa));
  const ba = bboxOf(a), bb = bboxOf(b);
  if (!ba || !bb || ba[0] > bb[2] || ba[2] < bb[0] || ba[1] > bb[3] || ba[3] < bb[1]) return false;
  return geomDistM(a, b) === 0;
}

export const mkProps = (fields: Field[], src: Record<string, any>) => {
  const o: Record<string, any> = {};
  for (const f of fields) o[f.name] = src[f.name] ?? null;
  return o;
};

export { mkFeature };
export type { BBox };
export { segIntersect };
