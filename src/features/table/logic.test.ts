import { describe, expect, it } from 'vitest';
import type { Feat } from '../../core/types';
import { compileWhere } from '../../core/expr';
import {
  clausesToExpr, computeStats, evaluateCalc, fieldNameError, filterByWhere, formatCell, parseEdit, searchFeatures, sortFeatures,
  uniqueValues, type Clause,
} from './logic';

const mk = (rows: Array<Record<string, any>>): Feat[] => rows.map((p, i) => ({ type: 'Feature', id: i + 1, geometry: null, properties: p }));
const ids = (fs: Feat[]) => fs.map((f) => f.id);

describe('rows', () => {
  const feats = mk([{ N: 'b', V: 3 }, { N: 'a', V: null }, { N: 'C', V: 1 }, { N: 'd', V: 2 }]);
  it('sorts with nulls last in both directions', () => {
    expect(ids(sortFeatures(feats, { field: 'V', dir: 'asc' }, 'integer'))).toEqual([3, 4, 1, 2]);
    expect(ids(sortFeatures(feats, { field: 'V', dir: 'desc' }, 'integer'))).toEqual([1, 4, 3, 2]);
    expect(ids(sortFeatures(feats, { field: 'N', dir: 'asc' }, 'string'))).toEqual([2, 1, 3, 4]);
    expect(sortFeatures(feats, null, 'string')).toBe(feats);
  });
  it('sorts numerically, not lexically', () => {
    const f = mk([{ V: 10 }, { V: 9 }, { V: 100 }]);
    expect(ids(sortFeatures(f, { field: 'V', dir: 'asc' }, 'number'))).toEqual([2, 1, 3]);
  });
  it('filters by definition query, tolerating bad queries', () => {
    expect(ids(filterByWhere(feats, 'V > 1'))).toEqual([1, 4]);
    expect(filterByWhere(feats, '')).toBe(feats);
    expect(filterByWhere(feats, 'V >')).toBe(feats);
  });
  it('searches across all columns', () => {
    const fields = [{ name: 'N', type: 'string' as const }, { name: 'V', type: 'integer' as const }];
    expect(ids(searchFeatures(feats, fields, 'C'))).toEqual([3]);
    expect(ids(searchFeatures(feats, fields, '2'))).toEqual([4]);
    expect(searchFeatures(feats, fields, '  ')).toBe(feats);
  });
  it('unique values', () => {
    expect(uniqueValues(mk([{ A: 'b' }, { A: 'a' }, { A: 'b' }, { A: null }]), 'A')).toEqual(['a', 'b']);
  });
});

describe('formatting and parsing', () => {
  it('formats cells', () => {
    expect(formatCell(5, 'integer')).toBe('5');
    expect(formatCell(0.1 + 0.2, 'number')).toBe('0.3');
    expect(formatCell(null, 'string')).toBe('');
    expect(formatCell(true, 'boolean')).toBe('true');
    expect(formatCell('2024-01-02T00:00:00.000Z', 'date')).toBe('2024-01-02');
  });
  it('parses edits', () => {
    expect(parseEdit('', 'number')).toEqual({ ok: true, value: null });
    expect(parseEdit('4.5', 'number')).toEqual({ ok: true, value: 4.5 });
    expect(parseEdit('4.5', 'integer').ok).toBe(false);
    expect(parseEdit('abc', 'number').ok).toBe(false);
    expect(parseEdit('Yes', 'boolean')).toEqual({ ok: true, value: true });
    expect(parseEdit('maybe', 'boolean').ok).toBe(false);
    expect(parseEdit('2024-02-03', 'date')).toEqual({ ok: true, value: '2024-02-03' });
    expect(parseEdit('zzz', 'date').ok).toBe(false);
    expect(parseEdit(' hi ', 'string')).toEqual({ ok: true, value: ' hi ' });
  });
});

describe('statistics', () => {
  it('computes summary values', () => {
    const s = computeStats([1, 2, 3, 4, null, '', 'x', 10])!;
    expect(s.count).toBe(5);
    expect(s.nulls).toBe(3);
    expect(s.sum).toBe(20);
    expect(s.mean).toBe(4);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(10);
    expect(s.stdDev).toBeCloseTo(Math.sqrt(10), 6);
    expect(s.bins.reduce((n, b) => n + b.n, 0)).toBe(5);
  });
  it('handles even counts, constants and empties', () => {
    expect(computeStats([1, 2, 3, 4])!.median).toBe(2.5);
    const c = computeStats([5, 5, 5])!;
    expect(c.bins).toEqual([{ x0: 5, x1: 5, n: 3 }]);
    expect(computeStats([null, 'a'])).toBeNull();
  });
});

describe('clause builder', () => {
  const types: Record<string, any> = { POP: 'integer', NAME: 'string', 'Land Use': 'string', OK: 'boolean' };
  const typeOf = (f: string) => types[f];
  const cl = (field: string, op: Clause['op'], value = ''): Clause => ({ id: 1, field, op, value });
  const run = (expr: string, props: Record<string, any>) => compileWhere(expr)({ properties: props });

  it('generates valid, correct expressions', () => {
    const e = clausesToExpr([cl('POP', 'gt', '100'), cl('NAME', 'starts', "O'B")], typeOf, 'AND');
    expect(e).toBe("POP > 100 AND NAME LIKE 'O''B%'");
    expect(run(e, { POP: 200, NAME: "O'Brien" })).toBe(true);
    expect(run(e, { POP: 50, NAME: "O'Brien" })).toBe(false);
  });
  it('brackets awkward names and joins with OR', () => {
    const e = clausesToExpr([cl('Land Use', 'eq', 'Park'), cl('NAME', 'contains', 'x')], typeOf, 'OR');
    expect(e).toBe("[Land Use] = 'Park' OR NAME LIKE '%x%'");
    expect(run(e, { 'Land Use': 'Park' })).toBe(true);
  });
  it('null checks, booleans, skipped incomplete rows', () => {
    expect(clausesToExpr([cl('NAME', 'null'), cl('OK', 'eq', 'true'), cl('POP', 'eq', '')], typeOf, 'AND')).toBe('NAME IS NULL AND OK = true');
    expect(clausesToExpr([cl('Gone', 'eq', '1')], typeOf, 'AND')).toBe('');
  });
  it('number literals stay numeric', () => {
    expect(clausesToExpr([cl('POP', 'ge', '1e3')], typeOf, 'AND')).toBe('POP >= 1000');
  });
});

describe('calculation', () => {
  it('coerces results to the target type', () => {
    const feats = mk([{ A: 2.6 }, { A: null }, { A: 4 }]);
    const m = evaluateCalc(feats, 'A * 2', 'integer');
    expect([...m]).toEqual([[1, 5], [2, null], [3, 8]]);
    expect(evaluateCalc(feats, "'v' + A", 'string').get(3)).toBe('v4');
  });
  it('validates field names', () => {
    expect(fieldNameError('', [])).toBeTruthy();
    expect(fieldNameError('pop', ['POP'])).toMatch(/exists/);
    expect(fieldNameError('a]b', [])).toBeTruthy();
    expect(fieldNameError('ok', ['POP'])).toBeNull();
  });
});
