// Statistics tools: Summary Statistics, Frequency.
import { buildResult, cleanStats, fieldsOfNames, groupBy, mkFeature, statFields, statValues, uniqueName } from '../geo';
import { ANY_OR_TABLE, NUMERIC, fieldsP, layerP, outP, statsP } from '../params';
import { ToolError, type GpFeature, type LayerData, type StatSpec, type ToolDef } from '../types';

const CAT = 'Statistics';

function sortRows(rows: GpFeature[][], names: string[]): GpFeature[][] {
  return rows.sort((a, b) => {
    for (const n of names) {
      const x = a[0].properties[n], y = b[0].properties[n];
      if (x == null || y == null) {
        if (x == null && y == null) continue;
        return x == null ? 1 : -1;
      }
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      if (c) return c;
    }
    return 0;
  });
}

function tabulate(input: LayerData, names: string[], stats: StatSpec[]): { features: GpFeature[]; freq: string } {
  const freq = uniqueName('FREQUENCY', [...names, ...stats.map((s) => `${s.stat.toUpperCase()}_${s.field}`)]);
  const groups = sortRows([...groupBy(input.features, names).values()], names);
  const features = groups.map((rows) => {
    const props: Record<string, any> = {};
    for (const n of names) props[n] = rows[0].properties[n] ?? null;
    props[freq] = rows.length;
    Object.assign(props, statValues(stats, rows));
    return mkFeature(null, props);
  });
  return { features, freq };
}

export const summaryStatistics: ToolDef = {
  id: 'summary-statistics',
  name: 'Summary Statistics',
  category: CAT,
  description:
    'Calculates statistics (sum, mean, min, max, range, standard deviation, median, count, first, last) for numeric fields and writes them to a table. Case fields produce one row per distinct combination of values.',
  keywords: ['statistics', 'sum', 'mean', 'average', 'min', 'max', 'median', 'table', 'aggregate'],
  outputPrefix: 'Stats',
  params: [
    layerP('input', 'Input table', { help: 'A feature layer or table.', geom: ANY_OR_TABLE }),
    {
      ...statsP('stats', 'Statistics', 'input', {
        help: 'Fields and the statistic to calculate for each. Text fields can be counted or take first/last. Add as many rows as needed.',
        types: ['number', 'integer', 'string', 'date', 'boolean'],
      }),
      optional: false,
    },
    fieldsP('cases', 'Case fields', 'input', { help: 'Optional. Statistics are calculated separately for each distinct combination of these fields.' }),
    outP('Name of the output table.'),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const stats = cleanStats(ctx.params.stats, input);
    if (!stats.length) throw new ToolError('Add at least one statistic (field and type).');
    const names: string[] = (ctx.params.cases ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
    const { features, freq } = tabulate(input, names, stats);
    ctx.message(`${input.features.length.toLocaleString()} records summarised into ${features.length.toLocaleString()} rows.`);
    return buildResult(features, {
      geomType: null,
      fields: [...fieldsOfNames(input, names), { name: freq, type: 'integer' }, ...statFields(stats, input.fields)],
    });
  },
};

export const frequency: ToolDef = {
  id: 'frequency',
  name: 'Frequency',
  category: CAT,
  description:
    'Counts how often each distinct combination of values occurs in one or more fields and writes the result to a table (FREQUENCY). Optionally sums numeric fields for each combination.',
  keywords: ['count', 'unique values', 'histogram', 'tally', 'distinct', 'table'],
  outputPrefix: 'Frequency',
  params: [
    layerP('input', 'Input table', { help: 'A feature layer or table.', geom: ANY_OR_TABLE }),
    { ...fieldsP('fields', 'Frequency fields', 'input', { help: 'Fields whose distinct value combinations are counted.' }), optional: false },
    fieldsP('sum', 'Sum fields', 'input', { help: 'Optional numeric fields to total for each combination.', types: NUMERIC }),
    outP('Name of the output table.'),
  ],
  run(ctx) {
    const input = ctx.layer('input');
    const names: string[] = (ctx.params.fields ?? []).filter((n: string) => input.fields.some((f) => f.name === n));
    if (!names.length) throw new ToolError('Choose at least one frequency field.');
    const stats: StatSpec[] = cleanStats((ctx.params.sum ?? []).map((field: string) => ({ field, stat: 'sum' })), input);
    const { features, freq } = tabulate(input, names, stats);
    ctx.message(`${features.length.toLocaleString()} distinct combinations found in ${input.features.length.toLocaleString()} records.`);
    return buildResult(features, {
      geomType: null,
      fields: [...fieldsOfNames(input, names), { name: freq, type: 'integer' }, ...statFields(stats, input.fields)],
    });
  },
};

export const STATS_TOOLS: ToolDef[] = [summaryStatistics, frequency];
