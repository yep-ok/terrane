import { describe, expect, it } from 'vitest';
import { formatDD, formatDMS, lonLatToUtm, parseCoordinate, utmToLonLat } from './coords';
import { formatArea, formatLength, toMetres } from './units';
import { formatValue } from './format';
import { parseNominatim } from './nominatim';
import { haversine, matchByLocation, minDistance, pathLength, ringArea } from './spatial';
import { normaliseCode } from './crsdialog';
import type { Feat } from '../../core/types';

const ok = (r: ReturnType<typeof parseCoordinate>) => {
  if (!r.ok) throw new Error(r.error);
  return r;
};

describe('parseCoordinate', () => {
  it('reads decimal degrees in both orders', () => {
    const a = ok(parseCoordinate('40.7128, -74.0060'));
    expect(a.lat).toBeCloseTo(40.7128, 6);
    expect(a.lon).toBeCloseTo(-74.006, 6);
    const b = ok(parseCoordinate('-74.0060 40.7128', 'lon-lat'));
    expect(b.lat).toBeCloseTo(40.7128, 6);
    expect(b.lon).toBeCloseTo(-74.006, 6);
  });
  it('reads DMS with hemisphere letters', () => {
    const r = ok(parseCoordinate(`40°42'46"N 74°0'21.6"W`));
    expect(r.lat).toBeCloseTo(40.71278, 4);
    expect(r.lon).toBeCloseTo(-74.006, 4);
  });
  it('lets hemisphere letters override the order', () => {
    const r = ok(parseCoordinate('74 0 21.6 W, 40 42 46 N', 'lat-lon'));
    expect(r.lat).toBeCloseTo(40.71278, 4);
    expect(r.lon).toBeCloseTo(-74.006, 4);
  });
  it('reads prefix hemispheres and unseparated DMS numbers', () => {
    const a = ok(parseCoordinate('N 40 42 46 W 74 0 21.6'));
    expect(a.lat).toBeCloseTo(40.71278, 4);
    expect(a.lon).toBeCloseTo(-74.006, 4);
    const b = ok(parseCoordinate('-33 51 54 151 12 36'));
    expect(b.lat).toBeCloseTo(-33.865, 3);
    expect(b.lon).toBeCloseTo(151.21, 3);
  });
  it('reads single-line UTM', () => {
    const r = ok(parseCoordinate('18T 583960 4507523'));
    expect(r.lat).toBeCloseTo(40.7128, 2);
    expect(r.lon).toBeCloseTo(-74.006, 2);
  });
  it('rejects bad input with a message', () => {
    expect(parseCoordinate('').ok).toBe(false);
    expect(parseCoordinate('95, 10')).toMatchObject({ ok: false });
    expect(parseCoordinate('10, 200')).toMatchObject({ ok: false });
    expect(parseCoordinate('hello')).toMatchObject({ ok: false });
    expect(parseCoordinate('40 N, 30 N')).toMatchObject({ ok: false });
  });
});

describe('utm', () => {
  it('round-trips', () => {
    const u = lonLatToUtm(-74.006, 40.7128);
    expect(u.zone).toBe(18);
    expect(u.north).toBe(true);
    expect(u.band).toBe('T');
    const back = utmToLonLat(u.zone, u.north, u.easting, u.northing);
    expect(ok(back).lon).toBeCloseTo(-74.006, 6);
    expect(ok(back).lat).toBeCloseTo(40.7128, 6);
  });
  it('validates ranges', () => {
    expect(utmToLonLat(0, true, 500000, 1).ok).toBe(false);
    expect(utmToLonLat(33, true, -5, 1).ok).toBe(false);
  });
});

describe('coordinate formatting', () => {
  it('formats DD and DMS', () => {
    expect(formatDD(-74.006, 40.7128)).toBe('40.712800, -74.006000');
    expect(formatDMS(-74.006, 40.7128, 1)).toBe(`40°42'46.1"N 74°00'21.6"W`);
  });
  it('carries rounding of seconds', () => {
    expect(formatDMS(10, 0.99999999, 0)).toBe(`1°00'00"N 10°00'00"E`);
  });
});

describe('units', () => {
  it('formats lengths', () => {
    expect(formatLength(12.345, 'metric', 'en-US')).toBe('12.35 m');
    expect(formatLength(1500, 'metric', 'en-US')).toBe('1.5 km');
    expect(formatLength(100, 'imperial', 'en-US')).toBe('328.1 ft');
    expect(formatLength(5000, 'imperial', 'en-US')).toBe('3.107 mi');
    expect(formatLength(1852, 'nautical', 'en-US')).toBe('1 nmi');
  });
  it('formats areas', () => {
    expect(formatArea(500, 'metric', 'en-US')).toBe('500 m²');
    expect(formatArea(50000, 'metric', 'en-US')).toBe('5 ha');
    expect(formatArea(2_500_000, 'metric', 'en-US')).toBe('2.5 km²');
    expect(formatArea(4046.8564224, 'imperial', 'en-US')).toBe('1 ac');
  });
  it('converts to metres', () => {
    expect(toMetres(2, 'km')).toBe(2000);
    expect(toMetres(1, 'nmi')).toBe(1852);
  });
});

describe('formatValue', () => {
  it('formats numbers, ids, nulls, links and dates', () => {
    expect(formatValue(1234567, { name: 'POP', type: 'integer' }, 'en-US')).toEqual({ kind: 'text', text: '1,234,567' });
    expect(formatValue(2020, { name: 'year', type: 'integer' }, 'en-US')).toEqual({ kind: 'text', text: '2020' });
    expect(formatValue(3.14159265, { name: 'ratio', type: 'number' }, 'en-US')).toEqual({ kind: 'text', text: '3.1416' });
    expect(formatValue(null)).toEqual({ kind: 'null' });
    expect(formatValue('https://example.com/a')).toMatchObject({ kind: 'link' });
    expect(formatValue('2021-03-04', { name: 'd', type: 'date' }, 'en-US')).toEqual({ kind: 'text', text: '3/4/2021' });
    expect(formatValue(true)).toEqual({ kind: 'text', text: 'Yes' });
  });
});

describe('nominatim', () => {
  it('parses results', () => {
    const r = parseNominatim([
      { place_id: 1, lat: '48.85', lon: '2.35', display_name: 'Paris, Ile-de-France, France', name: 'Paris', addresstype: 'city', boundingbox: ['48.8', '48.9', '2.2', '2.5'] },
      { place_id: 2, lat: 'x', lon: '1', display_name: 'bad' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].extent).toEqual([2.2, 48.8, 2.5, 48.9]);
    expect(r[0].name).toBe('Paris');
  });
});

describe('crs code', () => {
  it('normalises', () => {
    expect(normaliseCode('4326')).toBe('EPSG:4326');
    expect(normaliseCode(' epsg:27700 ')).toBe('EPSG:27700');
    expect(normaliseCode('nope')).toBeNull();
  });
});

describe('spatial', () => {
  it('measures geodesic length and area', () => {
    expect(haversine([0, 0], [0, 1])).toBeCloseTo(111195, -1);
    expect(pathLength([[0, 0], [0, 1], [0, 2]])).toBeCloseTo(222390, -1);
    expect(ringArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(1.2364e10, -7);
  });
  it('computes minimum distance', () => {
    const pt = { type: 'Point' as const, coordinates: [0, 0.01] };
    const line = { type: 'LineString' as const, coordinates: [[-1, 0], [1, 0]] };
    expect(minDistance(pt, line)).toBeCloseTo(1111.95, -1);
    expect(minDistance(line, line)).toBe(0);
  });

  const sq = (x: number, y: number, s: number): Feat['geometry'] => ({
    type: 'Polygon',
    coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]],
  });
  const f = (id: number, geometry: Feat['geometry']): Feat => ({ type: 'Feature', id, geometry, properties: {} });

  it('matches by location', async () => {
    const targets = [
      f(1, { type: 'Point', coordinates: [5, 5] }),
      f(2, { type: 'Point', coordinates: [20, 20] }),
      f(3, sq(2, 2, 2)),
      f(4, sq(8, 8, 5)),
      f(5, { type: 'Point', coordinates: [0, 0] }),
    ];
    const sources = [f(10, sq(0, 0, 10))];
    expect(await matchByLocation(targets, sources, { relation: 'intersect' })).toEqual([1, 3, 4, 5]);
    expect(await matchByLocation(targets, sources, { relation: 'within' })).toEqual([1, 3]);
    expect(await matchByLocation(targets, sources, { relation: 'completelyWithin' })).toEqual([1, 3]);
    expect(await matchByLocation(targets, sources, { relation: 'centerIn' })).toEqual([1, 3, 5]);
    expect(await matchByLocation(sources, targets, { relation: 'contains' })).toEqual([10]);
    expect(await matchByLocation(targets, sources, { relation: 'distance', distanceM: 100_000 })).toEqual([1, 3, 4, 5]);
    // 20,20 is ~1500 km from the square's corner
    expect(await matchByLocation([targets[1]], sources, { relation: 'distance', distanceM: 1_000_000 })).toEqual([]);
    expect(await matchByLocation([targets[1]], sources, { relation: 'distance', distanceM: 2_000_000 })).toEqual([2]);
  });
});
