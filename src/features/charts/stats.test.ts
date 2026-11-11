import { describe, expect, it } from 'vitest';
import {
  aggregate, boxStats, decimalsFor, formatTick, formatTime, groupBy, histogram, linearRegression, linearScale, median,
  naturalCompare, niceTicks, quantileSorted, stdDev, suggestBinCount, summarize, timeTicks, toNumber, truncate,
} from './stats';

describe('descriptive statistics', () => {
  it('computes quantiles with linear interpolation', () => {
    const s = [1, 2, 3, 4, 5];
    expect(quantileSorted(s, 0)).toBe(1);
    expect(quantileSorted(s, 0.5)).toBe(3);
    expect(quantileSorted(s, 0.25)).toBe(2);
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([], 0.5)).toBeNaN();
  });
  it('computes median, std-dev and summary', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    expect(stdDev([1])).toBe(0);
    const s = summarize([1, 2, 3, 4]);
    expect(s).toMatchObject({ n: 4, min: 1, max: 4, mean: 2.5, median: 2.5, sum: 10 });
    expect(summarize([]).n).toBe(0);
  });
  it('finds box-plot whiskers and outliers', () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
    const { stats, outliers } = boxStats(v);
    expect(stats.q1).toBeCloseTo(3.25);
    expect(stats.q3).toBeCloseTo(7.75);
    expect(stats.upperWhisker).toBe(9);
    expect(stats.lowerWhisker).toBe(1);
    expect(outliers).toEqual([9]);
    expect(boxStats([4]).stats.median).toBe(4);
  });
});

describe('linearRegression', () => {
  it('fits a perfect line', () => {
    const r = linearRegression([1, 2, 3, 4], [3, 5, 7, 9])!;
    expect(r.slope).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(1);
    expect(r.r2).toBeCloseTo(1);
  });
  it('reports r2 below one for noisy data and handles degenerate input', () => {
    const r = linearRegression([1, 2, 3, 4, 5], [2, 1, 4, 3, 5])!;
    expect(r.r2).toBeGreaterThan(0.3);
    expect(r.r2).toBeLessThan(1);
    expect(linearRegression([2, 2, 2], [1, 2, 3])).toBeNull();
    expect(linearRegression([1], [1])).toBeNull();
  });
});

describe('aggregate / groupBy', () => {
  it('aggregates', () => {
    const v = [2, 4, 9];
    expect(aggregate(v, 'count')).toBe(3);
    expect(aggregate(v, 'sum')).toBe(15);
    expect(aggregate(v, 'mean')).toBe(5);
    expect(aggregate(v, 'min')).toBe(2);
    expect(aggregate(v, 'max')).toBe(9);
    expect(aggregate([], 'sum')).toBe(0);
    expect(aggregate([], 'max')).toBeNaN();
  });
  it('groups in first-appearance order', () => {
    const g = groupBy(['b1', 'a1', 'b2'], (s) => s[0]);
    expect([...g.keys()]).toEqual(['b', 'a']);
    expect(g.get('b')).toEqual(['b1', 'b2']);
  });
  it('sorts naturally', () => {
    expect(['a10', 'a2', 'a1'].sort(naturalCompare)).toEqual(['a1', 'a2', 'a10']);
  });
});

describe('histogram', () => {
  it('bins every value, closing the last bin', () => {
    const bins = histogram([0, 1, 2, 3, 4, 10], (x) => x, 5);
    expect(bins).toHaveLength(5);
    expect(bins.reduce((n, b) => n + b.items.length, 0)).toBe(6);
    expect(bins[0].x0).toBe(0);
    expect(bins[4].x1).toBe(10);
    expect(bins[4].items).toContain(10);
    expect(bins[0].items).toEqual([0, 1]);
  });
  it('handles constant and empty input', () => {
    const b = histogram([5, 5, 5], (x) => x, 4);
    expect(b.reduce((n, x) => n + x.items.length, 0)).toBe(3);
    expect(b[0].x0).toBeLessThan(5);
    expect(histogram([], (x: number) => x, 4)).toEqual([]);
  });
  it('suggests a sensible bin count', () => {
    expect(suggestBinCount(1)).toBe(5);
    expect(suggestBinCount(1000)).toBe(11);
    expect(suggestBinCount(1e9)).toBe(31);
  });
});

describe('ticks and formatting', () => {
  it('produces nice ticks covering the data', () => {
    const t = niceTicks(0, 97, 6);
    expect(t.min).toBe(0);
    expect(t.max).toBe(100);
    expect(t.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    const f = niceTicks(0.12, 0.93, 5);
    expect(f.ticks[0]).toBeLessThanOrEqual(0.12);
    expect(f.ticks[f.ticks.length - 1]).toBeGreaterThanOrEqual(0.93);
    expect(f.ticks).toContain(0.4);
  });
  it('handles degenerate ranges and negatives', () => {
    const d = niceTicks(5, 5);
    expect(d.min).toBeLessThan(5);
    expect(d.max).toBeGreaterThan(5);
    const n = niceTicks(-3, 7);
    expect(n.ticks).toContain(0);
    expect(niceTicks(NaN, 1).ticks.length).toBeGreaterThan(1);
  });
  it('does not extend the domain when asked not to', () => {
    const t = niceTicks(3, 97, 6, false);
    expect(t.min).toBe(3);
    expect(t.max).toBe(97);
    expect(t.ticks[0]).toBeGreaterThanOrEqual(3);
  });
  it('formats ticks', () => {
    expect(decimalsFor(0.1)).toBe(1);
    expect(decimalsFor(5)).toBe(0);
    expect(formatTick(1200, 200)).toBe('1,200');
    expect(formatTick(2500000)).toBe('2.5M');
    expect(formatTick(0.5, 0.1)).toBe('0.5');
  });
  it('truncates labels', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});

describe('time axis', () => {
  it('uses calendar-aligned year ticks for long spans', () => {
    const t = timeTicks(Date.UTC(2000, 3, 1), Date.UTC(2020, 5, 1), 6);
    expect(t.ticks.length).toBeGreaterThan(2);
    for (const x of t.ticks) {
      const d = new Date(x);
      expect(d.getUTCMonth()).toBe(0);
      expect(d.getUTCDate()).toBe(1);
    }
    expect(formatTime(t.ticks[0], t.step)).toMatch(/^\d{4}$/);
  });
  it('uses month and day ticks for shorter spans', () => {
    const m = timeTicks(Date.UTC(2020, 0, 10), Date.UTC(2020, 11, 10), 6);
    for (const x of m.ticks) expect(new Date(x).getUTCDate()).toBe(1);
    const d = timeTicks(Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 20), 6);
    expect(d.ticks.length).toBeGreaterThan(2);
  });
});

describe('scales and parsing', () => {
  it('maps and inverts linearly', () => {
    const s = linearScale([0, 10], [100, 0]);
    expect(s(5)).toBe(50);
    expect(s.invert(25)).toBe(7.5);
    expect(linearScale([3, 3], [0, 10])(3)).toBe(0);
  });
  it('parses numbers and dates', () => {
    expect(toNumber('4.5')).toBe(4.5);
    expect(toNumber('')).toBeNull();
    expect(toNumber('abc')).toBeNull();
    expect(toNumber(true)).toBeNull();
    expect(toNumber('2020-01-01', true)).toBe(Date.UTC(2020, 0, 1));
    expect(toNumber('nope', true)).toBeNull();
  });
});
