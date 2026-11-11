import { useMemo, useState } from 'react';
import { useDataset, useDatasetVersion } from '../../core/data';
import { useLayer } from '../../core/store';
import { useSelection } from '../../core/ui';
import { Button, Checkbox, Empty, FieldSelect, NUMERIC, Row } from '../../ui/kit';
import { computeStats, filterByWhere, type Stats } from './logic';

function num(n: number): string {
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e12 || a < 1e-4)) return n.toExponential(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: a >= 1000 ? 2 : 4 });
}

function Histogram({ stats }: { stats: Stats }) {
  const W = 520;
  const H = 170;
  const m = { l: 44, r: 10, t: 8, b: 24 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxN = Math.max(...stats.bins.map((b) => b.n), 1);
  const bw = iw / stats.bins.length;
  const ticks = [0, 0.5, 1].map((t) => Math.round(maxN * t));
  return (
    <svg className="tbl-hist" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Histogram">
      {ticks.map((t, i) => {
        const y = m.t + ih - (t / maxN) * ih;
        return (
          <g key={i}>
            <line x1={m.l} x2={W - m.r} y1={y} y2={y} className="grid" />
            <text x={m.l - 5} y={y + 3} textAnchor="end" className="axis">{t.toLocaleString()}</text>
          </g>
        );
      })}
      {stats.bins.map((b, i) => {
        const h = (b.n / maxN) * ih;
        return (
          <rect key={i} x={m.l + i * bw + 0.5} y={m.t + ih - h} width={Math.max(1, bw - 1)} height={h} className="bar">
            <title>{`${num(b.x0)} to ${num(b.x1)}: ${b.n.toLocaleString()}`}</title>
          </rect>
        );
      })}
      <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} className="base" />
      <text x={m.l} y={H - 7} textAnchor="start" className="axis">{num(stats.min)}</text>
      <text x={m.l + iw / 2} y={H - 7} textAnchor="middle" className="axis">{num((stats.min + stats.max) / 2)}</text>
      <text x={W - m.r} y={H - 7} textAnchor="end" className="axis">{num(stats.max)}</text>
    </svg>
  );
}

export function StatsDialog({ props, close }: { props: { layerId?: string; field?: string }; close: () => void }) {
  const layer = useLayer(props.layerId);
  const fl = layer?.kind === 'feature' ? layer : undefined;
  const ds = useDataset(fl?.datasetId);
  const version = useDatasetVersion(fl?.datasetId);
  const selection = useSelection(props.layerId);
  const [field, setField] = useState(props.field ?? ds?.fields.find((f) => NUMERIC.includes(f.type))?.name ?? '');
  const [selOnly, setSelOnly] = useState(selection.length > 0);
  const effSel = selOnly && selection.length > 0;

  const stats = useMemo(() => {
    if (!ds || !fl || !field) return null;
    let feats = filterByWhere(ds.features, fl.definitionQuery);
    if (effSel) {
      const s = new Set(selection);
      feats = feats.filter((f) => s.has(f.id));
    }
    return { total: feats.length, stats: computeStats(feats.map((f) => f.properties[field])) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, fl?.definitionQuery, field, effSel, selection, version]);

  if (!fl || !ds) {
    return (
      <>
        <div className="dialog-body"><Empty title="No layer">Select a feature layer first.</Empty></div>
        <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
      </>
    );
  }
  const s = stats?.stats;
  const rows: Array<[string, string]> = s
    ? [
        ['Count', s.count.toLocaleString()],
        ['Nulls', s.nulls.toLocaleString()],
        ['Sum', num(s.sum)],
        ['Mean', num(s.mean)],
        ['Median', num(s.median)],
        ['Minimum', num(s.min)],
        ['Maximum', num(s.max)],
        ['Std. deviation', num(s.stdDev)],
      ]
    : [];

  return (
    <>
      <div className="dialog-body tbl-dialog">
        <Row label="Layer"><span className="grow tbl-ellipsis">{fl.name}</span></Row>
        <Row label="Field">
          <FieldSelect datasetId={ds.id} value={field} onChange={setField} types={NUMERIC} placeholder="Numeric field…" />
        </Row>
        <Checkbox
          checked={effSel}
          onChange={setSelOnly}
          disabled={selection.length === 0}
          label={selection.length ? `Selected records only (${selection.length.toLocaleString()})` : 'Selected records only (none selected)'}
        />
        {!field && <Empty title="No numeric field">This layer has no numeric fields to summarise.</Empty>}
        {field && !s && <div className="tbl-msg tbl-faint" style={{ marginTop: 10 }}>No numeric values in {stats?.total.toLocaleString() ?? 0} records.</div>}
        {s && (
          <>
            <div className="tbl-stats">
              {rows.map(([k, v]) => (
                <div key={k} className="tbl-stat">
                  <span className="tbl-faint">{k}</span>
                  <b>{v}</b>
                </div>
              ))}
            </div>
            <div className="tbl-label">Distribution</div>
            <Histogram stats={s} />
          </>
        )}
      </div>
      <div className="dialog-footer"><Button onClick={close}>Close</Button></div>
    </>
  );
}
