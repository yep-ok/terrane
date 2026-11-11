import { describe, expect, it } from 'vitest';
import type { Dataset, Feat, Renderer } from '../../core/types';
import { BASE_CONFIG, makeConfig, pickFields, type ChartConfig } from './config';
import { buildModel, modelToTable, resolveColors, tableToCsv, OTHER_KEY } from './model';

function makeDs(rows: Array<Record<string, any>>): Dataset {
  const features: Feat[] = rows.map((p, i) => ({ type: 'Feature', id: i + 1, geometry: null, properties: p }));
  return {
    id: 'ds', name: 'Test', geomType: null, features, nextFid: rows.length + 1,
    fields: [
      { name: 'KIND', type: 'string' }, { name: 'AREA', type: 'number' }, { name: 'POP', type: 'integer' },
      { name: 'REGION', type: 'string' }, { name: 'WHEN', type: 'date' },
    ],
  };
}
const ROWS = [
  { KIND: 'a', AREA: 1, POP: 10, REGION: 'n', WHEN: '2020-01-01' },
  { KIND: 'a', AREA: 2, POP: 20, REGION: 's', WHEN: '2020-01-01' },
  { KIND: 'b', AREA: 3, POP: 30, REGION: 'n', WHEN: '2021-01-01' },
  { KIND: 'c', AREA: 4, POP: 40, REGION: 'n', WHEN: '2022-01-01' },
  { KIND: 'c', AREA: 5, POP: null, REGION: 's', WHEN: '2022-01-01' },
  { KIND: null, AREA: 6, POP: 60, REGION: 's', WHEN: '2023-01-01' },
];
const ds = makeDs(ROWS);
const cfg = (patch: Partial<ChartConfig>): ChartConfig => ({ ...BASE_CONFIG, type: 'bar', category: 'KIND', ...patch });
const none = new Set<number>();

describe('bar model', () => {
  it('counts per category and sorts by value', () => {
    const m = buildModel(ds.features, cfg({}), ds, none);
    if (m.kind !== 'bar') throw new Error('expected bar');
    expect(m.cats.map((c) => [c.label, c.total])).toEqual([['a', 2], ['c', 2], ['b', 1], ['(empty)', 1]].sort((x, y) => (y[1] as number) - (x[1] as number)));
    expect(m.cats.find((c) => c.label === 'a')!.fids).toEqual([1, 2]);
  });
  it('aggregates a numeric field and skips missing values', () => {
    const m = buildModel(ds.features, cfg({ agg: 'sum', valueField: 'POP', sort: 'label' }), ds, none);
    if (m.kind !== 'bar') throw new Error();
    expect(m.cats.map((c) => c.label)).toEqual(['(empty)', 'a', 'b', 'c']);
    expect(m.cats.map((c) => c.total)).toEqual([60, 30, 30, 40]);
    expect(m.cats.find((c) => c.label === 'c')!.total).toBe(40);
    expect(m.skipped).toBe(1);
  });
  it('folds categories beyond top-N into Other, which sorts last', () => {
    const m = buildModel(ds.features, cfg({ topN: 1 }), ds, none);
    if (m.kind !== 'bar') throw new Error();
    expect(m.cats).toHaveLength(2);
    expect(m.cats[1].key).toBe(OTHER_KEY);
    expect(m.cats[0].count + m.cats[1].count).toBe(6);
  });
  it('splits into series and only stacks additive aggregations', () => {
    const m = buildModel(ds.features, cfg({ splitField: 'REGION', splitMode: 'stacked' }), ds, none);
    if (m.kind !== 'bar') throw new Error();
    expect(m.stacked).toBe(true);
    expect(m.series.map((s) => s.label)).toEqual(['n', 's']);
    const mean = buildModel(ds.features, cfg({ splitField: 'REGION', splitMode: 'stacked', agg: 'mean', valueField: 'AREA' }), ds, none);
    if (mean.kind !== 'bar') throw new Error();
    expect(mean.stacked).toBe(false);
  });
  it('reports the selected portion', () => {
    const m = buildModel(ds.features, cfg({ sort: 'label' }), ds, new Set([1]));
    if (m.kind !== 'bar') throw new Error();
    const a = m.cats.find((c) => c.label === 'a')!;
    expect(a.selCount).toBe(1);
    expect(a.selTotal).toBe(1);
  });
});

describe('other chart models', () => {
  it('bins a histogram with selection and stats', () => {
    const m = buildModel(ds.features, { ...cfg({}), type: 'histogram', field: 'AREA', bins: 3 }, ds, new Set([6]));
    if (m.kind !== 'histogram') throw new Error();
    expect(m.bins.reduce((n, b) => n + b.count, 0)).toBe(6);
    expect(m.bins[2].sel).toBe(1);
    expect(m.stats.mean).toBeCloseTo(3.5);
    expect(m.meanX).toBeCloseTo(3.5);
  });
  it('log transform drops non-positive values', () => {
    const d = makeDs([{ AREA: 0 }, { AREA: 10 }, { AREA: 1000 }]);
    const m = buildModel(d.features, { ...cfg({}), type: 'histogram', field: 'AREA', bins: 2, logScale: true }, d, none);
    if (m.kind !== 'histogram') throw new Error();
    expect(m.notes.join(' ')).toMatch(/1 values/);
    expect(m.bins.reduce((n, b) => n + b.count, 0)).toBe(2);
  });
  it('fits a scatter trend line', () => {
    const m = buildModel(ds.features, { ...cfg({}), type: 'scatter', xField: 'AREA', yField: 'POP', colorField: 'REGION' }, ds, none);
    if (m.kind !== 'scatter') throw new Error();
    expect(m.points).toHaveLength(5);
    expect(m.groups.map((g) => g.label)).toEqual(['n', 's']);
    expect(m.trend!.slope).toBeCloseTo(10, 0);
  });
  it('aggregates repeated X values in a line chart (dates)', () => {
    const m = buildModel(ds.features, { ...cfg({}), type: 'line', xField: 'WHEN', yFields: ['AREA'], agg: 'sum' }, ds, none);
    if (m.kind !== 'line') throw new Error();
    expect(m.xIsDate).toBe(true);
    expect(m.series[0].pts.map((p) => p.y)).toEqual([3, 3, 9, 6]);
  });
  it('computes box statistics per category', () => {
    const m = buildModel(ds.features, { ...cfg({}), type: 'box', field: 'AREA', category: 'REGION', sort: 'label' }, ds, none);
    if (m.kind !== 'box') throw new Error();
    expect(m.boxes.map((b) => b.label)).toEqual(['n', 's']);
    expect(m.boxes[0].stats.median).toBe(3);
  });
  it('builds a pie from positive totals', () => {
    const m = buildModel(ds.features, { ...cfg({}), type: 'pie' }, ds, none);
    if (m.kind !== 'pie') throw new Error();
    expect(m.sum).toBe(6);
  });
});

describe('states', () => {
  it('flags missing configuration and empty data', () => {
    expect(buildModel(ds.features, cfg({ category: '' }), ds, none).kind).toBe('invalid');
    const empty = buildModel([], cfg({ selectionOnly: true }), ds, none);
    expect(empty.kind === 'invalid' && empty.message).toMatch(/No selected/);
  });
});

describe('colours, defaults and export', () => {
  it('matches unique-value symbology and greys out unmatched keys', () => {
    const sym = (fill: string) => ({ fill, fillOpacity: 1, stroke: '#000', strokeWidth: 1, size: 5, shape: 'circle' as const });
    const r: Renderer = { type: 'unique', field: 'KIND', defaultSymbol: null, classes: [{ value: 'a', label: 'a', symbol: sym('#111111') }] };
    const c = resolveColors({ ...BASE_CONFIG, type: 'bar', colorMode: 'symbology' }, r, 'KIND', ['a', 'zzz'], false);
    expect(c[0]).toBe('#111111');
    expect(c[1]).not.toBe('#111111');
  });
  it('uses the single colour unless entities must differ', () => {
    const one = resolveColors({ ...BASE_CONFIG, type: 'bar', color: '#abcdef' }, undefined, 'x', ['a', 'b'], false);
    expect(one).toEqual(['#abcdef', '#abcdef']);
    const many = resolveColors({ ...BASE_CONFIG, type: 'bar', color: '#abcdef' }, undefined, 'x', ['a', 'b'], true);
    expect(many[0]).not.toBe(many[1]);
  });
  it('derives sensible default fields from the schema', () => {
    const pick = pickFields(ds);
    expect(pick.category).toBe('KIND');
    expect(pick.numeric).toEqual(['AREA', 'POP']);
    expect(pick.date).toBe('WHEN');
    const c = makeConfig('scatter', ds);
    expect([c.xField, c.yField]).toEqual(['AREA', 'POP']);
    const l = makeConfig('line', ds);
    expect(l.xField).toBe('WHEN');
    expect(l.agg).toBe('mean');
  });
  it('exports quoted CSV', () => {
    const m = buildModel(ds.features, cfg({}), ds, none);
    const csv = tableToCsv(modelToTable(m, cfg({})));
    expect(csv.split('\n')[0]).toBe('KIND,Count,Features');
    expect(tableToCsv([['a,b', 'say "hi"']])).toBe('"a,b","say ""hi"""');
  });
});
