import { describe, expect, it } from 'vitest';
import type { Geometry, Polygon, Position } from 'geojson';
import { area } from '@turf/turf';
import {
  bboxOf, explodeGeometry, flipLine, geometrySummary, isValidSketch, listVertices, mergeGeometries, pivotOf,
  removeVertex, rotateGeometry, scaleGeometry, splitGeometry, splitLine, translateGeometry,
} from './geom';

const sq = (x0: number, y0: number, s = 1): Position[] => [[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]];
const poly = (...rings: Position[][]): Polygon => ({ type: 'Polygon', coordinates: rings });
const planarArea = (g: Geometry) => area({ type: 'Feature', properties: {}, geometry: g });

describe('split', () => {
  it('splits a square with a vertical line into two halves', () => {
    const out = splitGeometry(poly(sq(0, 0, 1)), [[0.5, -1], [0.5, 2]])!;
    expect(out).toHaveLength(2);
    const a = out.map(planarArea);
    expect(Math.abs(a[0] - a[1]) / a[0]).toBeLessThan(0.01);
    expect(a[0] + a[1]).toBeCloseTo(planarArea(poly(sq(0, 0, 1))), -2);
  });

  it('returns null when the line does not cross the polygon', () => {
    expect(splitGeometry(poly(sq(0, 0, 1)), [[2, -1], [2, 2]])).toBeNull();
    // ends inside: not edge to edge
    expect(splitGeometry(poly(sq(0, 0, 1)), [[0.5, -1], [0.5, 0.5]])).toBeNull();
  });

  it('splits a U shape into three pieces with one line', () => {
    const u: Position[] = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]];
    const out = splitGeometry(poly(u), [[-1, 2], [4, 2]])!;
    expect(out).toHaveLength(3);
    const total = out.reduce((n, g) => n + planarArea(g), 0);
    expect(total / planarArea(poly(u))).toBeCloseTo(1, 4);
  });

  it('splits a polygon with a hole and keeps the hole out', () => {
    const p = poly(sq(0, 0, 4), sq(1, 1, 2).slice().reverse());
    const out = splitGeometry(p, [[2, -1], [2, 5]])!;
    expect(out).toHaveLength(2);
    const total = out.reduce((n, g) => n + planarArea(g), 0);
    expect(total / planarArea(p)).toBeCloseTo(1, 3);
  });

  it('splits through a vertex and along a polyline cutter', () => {
    const out = splitGeometry(poly(sq(0, 0, 2)), [[-1, -1], [1, 1], [1, 3]])!;
    expect(out).toHaveLength(2);
    const total = out.reduce((n, g) => n + planarArea(g), 0);
    expect(total / planarArea(poly(sq(0, 0, 2)))).toBeCloseTo(1, 4);
  });

  it('keeps untouched parts of a multipolygon together', () => {
    const mp: Geometry = { type: 'MultiPolygon', coordinates: [[sq(0, 0, 1)], [sq(5, 5, 1)], [sq(8, 8, 1)]] };
    const out = splitGeometry(mp, [[0.5, -1], [0.5, 2]])!;
    expect(out).toHaveLength(3);
    expect(out[2].type).toBe('MultiPolygon');
  });

  it('splits lines at each crossing', () => {
    expect(splitLine([[0, 0], [10, 0]], [[5, -1], [5, 1]])).toEqual([[[0, 0], [5, 0]], [[5, 0], [10, 0]]]);
    expect(splitLine([[0, 0], [10, 0]], [[2, -1], [2, 1], [8, 1], [8, -1]])).toHaveLength(3);
    expect(splitGeometry({ type: 'LineString', coordinates: [[0, 0], [10, 0]] }, [[20, -1], [20, 1]])).toBeNull();
  });

  it('rejects a self-crossing cutter on polygons', () => {
    expect(() => splitGeometry(poly(sq(0, 0, 4)), [[1, -1], [1, 5], [3, 5], [3, -1], [0.5, 2], [5, 2]])).toThrow();
  });
});

describe('merge', () => {
  it('unions adjacent polygons', () => {
    const g = mergeGeometries([poly(sq(0, 0)), poly(sq(1, 0))])!;
    expect(g.type).toBe('Polygon');
    expect(planarArea(g) / planarArea(poly(sq(0, 0)))).toBeCloseTo(2, 3);
  });
  it('keeps disjoint polygons as a multipolygon', () => {
    expect(mergeGeometries([poly(sq(0, 0)), poly(sq(5, 0))])!.type).toBe('MultiPolygon');
  });
  it('joins lines that meet end to end', () => {
    const g = mergeGeometries([
      { type: 'LineString', coordinates: [[0, 0], [1, 0]] },
      { type: 'LineString', coordinates: [[2, 0], [1, 0]] },
    ])!;
    expect(g).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 0], [2, 0]] });
  });
  it('combines points into a multipoint and rejects mixed families', () => {
    expect(mergeGeometries([{ type: 'Point', coordinates: [0, 0] }, { type: 'Point', coordinates: [1, 1] }])!.type).toBe('MultiPoint');
    expect(() => mergeGeometries([{ type: 'Point', coordinates: [0, 0] }, poly(sq(0, 0))])).toThrow();
  });
});

describe('explode', () => {
  it('splits multipart geometries and keeps holes', () => {
    expect(explodeGeometry({ type: 'MultiPolygon', coordinates: [[sq(0, 0)], [sq(3, 3)]] })).toHaveLength(2);
    const holed = poly(sq(0, 0, 4), sq(1, 1, 1));
    expect(explodeGeometry(holed)).toEqual([holed]);
    expect(explodeGeometry({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1], [2, 2]] })).toHaveLength(3);
  });
});

describe('transforms', () => {
  it('rotates clockwise about a pivot at the equator', () => {
    const g = rotateGeometry({ type: 'Point', coordinates: [1, 0] }, 90, [0, 0]) as any;
    expect(g.coordinates[0]).toBeCloseTo(0, 9);
    expect(g.coordinates[1]).toBeCloseTo(-1, 9);
  });
  it('rotating 360 degrees is the identity', () => {
    const p = poly(sq(10, 50, 0.1));
    const r = rotateGeometry(p, 360, pivotOf([p])!) as Polygon;
    r.coordinates[0].forEach((c, i) => {
      expect(c[0]).toBeCloseTo(p.coordinates[0][i][0], 9);
      expect(c[1]).toBeCloseTo(p.coordinates[0][i][1], 9);
    });
  });
  it('scales about the centre', () => {
    const p = poly(sq(0, 0, 2));
    const s = scaleGeometry(p, 2, [1, 1]);
    expect(bboxOf([s])).toEqual([-1, -1, 3, 3]);
  });
  it('translates and flips lines', () => {
    expect(translateGeometry({ type: 'Point', coordinates: [1, 1] }, 1, -1)).toEqual({ type: 'Point', coordinates: [2, 0] });
    expect(flipLine({ type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] })).toEqual({ type: 'LineString', coordinates: [[2, 0], [1, 1], [0, 0]] });
  });
});

describe('vertices', () => {
  it('lists and removes vertices with validity checks', () => {
    const p = poly([[0, 0], [2, 0], [2, 2], [1, 3], [0, 2], [0, 0]]);
    expect(listVertices(p)).toHaveLength(5);
    const r = removeVertex(p, [0, 0]) as Polygon;
    expect(r.coordinates[0]).toEqual([[2, 0], [2, 2], [1, 3], [0, 2], [2, 0]]);
    expect(removeVertex(poly(sq(0, 0)), [0, 0])).not.toBeNull();
    expect(removeVertex(poly([[0, 0], [1, 0], [0, 1], [0, 0]]), [0, 1])).toBeNull();
    expect(removeVertex({ type: 'LineString', coordinates: [[0, 0], [1, 0]] }, [0])).toBeNull();
  });
  it('summarises geometry', () => {
    const s = geometrySummary({ type: 'LineString', coordinates: [[0, 0], [1, 0]] })!;
    expect(s.vertices).toBe(2);
    expect(s.length! / 1000).toBeCloseTo(111.2, 0);
    expect(isValidSketch({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 0], [0, 0]]] })).toBe(false);
  });
});
