import { describe, expect, it } from 'vitest';
import {
  classIndex, collectNumbers, computeBreaks, equalInterval, histogram, naturalBreaks, numericValue, quantile, rangeClasses,
  relabel, setUpperBound, standardDeviation, uniqueValues,
} from './classify';
import type { SymbolDef } from '../../core/types';

const sym: SymbolDef = { fill: '#000000', fillOpacity: 1, stroke: '#000000', strokeWidth: 1, size: 5, shape: 'circle' };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe('numericValue', () => {
  it('parses and rejects', () => {
    expect(numericValue({ a: '12' }, 'a')).toBe(12);
    expect(numericValue({ a: null }, 'a')).toBeNull();
    expect(numericValue({ a: 'x' }, 'a')).toBeNull();
  });
  it('normalises and guards zero', () => {
    expect(numericValue({ a: 10, b: 4 }, 'a', 'b')).toBe(2.5);
    expect(numericValue({ a: 10, b: 0 }, 'a', 'b')).toBeNull();
  });
  it('collects', () => {
    expect(collectNumbers([{ properties: { a: 1 } }, { properties: { a: null } }, { properties: { a: 3 } }], 'a')).toEqual([1, 3]);
  });
});

describe('breaks', () => {
  it('equal interval covers the range', () => {
    const b = equalInterval(range(0, 100), 4);
    expect(b.min).toBe(0);
    expect(b.uppers).toEqual([25, 50, 75, 100]);
  });
  it('quantile gives roughly equal counts', () => {
    const v = range(1, 100);
    const b = quantile(v, 4);
    expect(b.uppers).toEqual([25, 50, 75, 100]);
  });
  it('natural breaks separates clusters', () => {
    const v = [1, 2, 2, 3, 50, 51, 52, 53, 200, 201, 202];
    const b = naturalBreaks(v, 3);
    expect(b.uppers).toEqual([3, 53, 202]);
  });
  it('natural breaks tolerates few distinct values', () => {
    const b = naturalBreaks([5, 5, 5, 7], 6);
    expect(b.uppers[b.uppers.length - 1]).toBe(7);
    expect(b.uppers.length).toBeLessThanOrEqual(2);
  });
  it('standard deviation is centred on the mean', () => {
    const b = standardDeviation(range(0, 100), 4);
    expect(b.uppers.length).toBeGreaterThan(1);
    expect(b.uppers[b.uppers.length - 1]).toBe(100);
    for (let i = 1; i < b.uppers.length; i++) expect(b.uppers[i]).toBeGreaterThan(b.uppers[i - 1]);
  });
  it('constant data yields one class', () => {
    expect(computeBreaks([3, 3, 3], 'equal', 5).uppers).toEqual([3]);
    expect(computeBreaks([], 'quantile', 5).uppers).toEqual([0]);
  });
  it('rounds to tidy decimals', () => {
    const b = equalInterval([0, 1], 3);
    expect(b.uppers).toEqual([0.33, 0.67, 1]);
  });
});

describe('classes', () => {
  it('builds contiguous labelled classes', () => {
    const cls = rangeClasses({ min: 0, max: 100, uppers: [25, 100] }, [sym, sym]);
    expect(cls.map((c) => [c.min, c.max])).toEqual([[0, 25], [25, 100]]);
    expect(cls[0].label).toBe('0 – 25');
  });
  it('editing a bound moves its neighbour and relabels', () => {
    const cls = rangeClasses({ min: 0, max: 100, uppers: [25, 50, 100] }, [sym]);
    const next = setUpperBound(cls, 0, 30.5);
    expect(next[0].max).toBe(30.5);
    expect(next[1].min).toBe(30.5);
    expect(next[0].label).toBe('0.0 – 30.5');
    expect(relabel(next)[1].label).toBe('30.5 – 50.0');
  });
  it('clamps a bound between neighbours', () => {
    const cls = rangeClasses({ min: 0, max: 100, uppers: [25, 50, 100] }, [sym]);
    expect(setUpperBound(cls, 0, 80)[0].max).toBe(50);
    expect(setUpperBound(cls, 1, -5)[1].max).toBe(25);
  });
  it('finds the class index', () => {
    const cls = rangeClasses({ min: 0, max: 100, uppers: [25, 50, 100] }, [sym]);
    expect(classIndex(cls, 0)).toBe(0);
    expect(classIndex(cls, 25)).toBe(0);
    expect(classIndex(cls, 25.1)).toBe(1);
    expect(classIndex(cls, 100)).toBe(2);
    expect(classIndex(cls, 101)).toBe(-1);
  });
});

describe('uniqueValues', () => {
  const feats = ['b', 'a', 'b', null, 'c', '', 'b'].map((v) => ({ properties: { k: v } }));
  it('counts, sorts and puts null last', () => {
    const { values, total } = uniqueValues(feats, 'k');
    expect(values).toEqual([{ value: 'a', count: 1 }, { value: 'b', count: 3 }, { value: 'c', count: 1 }, { value: '', count: 2 }]);
    expect(total).toBe(4);
  });
  it('sorts numbers numerically', () => {
    const { values } = uniqueValues([10, 2, 33, 2].map((v) => ({ properties: { n: v } })), 'n');
    expect(values.map((v) => v.value)).toEqual(['2', '10', '33']);
  });
  it('caps the list but reports the total', () => {
    const many = range(1, 300).map((v) => ({ properties: { n: v } }));
    const { values, total } = uniqueValues(many, 'n', 200);
    expect(values).toHaveLength(200);
    expect(total).toBe(300);
  });
});

describe('histogram', () => {
  it('bins values', () => {
    const h = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(11);
    expect(h.min).toBe(0);
    expect(h.max).toBe(10);
  });
});
