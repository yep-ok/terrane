// Histogram renderer with mean / median / std-dev overlays and a summary-statistics panel.
import { useMemo } from 'react';
import type { HistModel } from './model';
import { formatTick, formatValue, linearScale, niceTicks } from './stats';
import {
  AxisTitles, Title, ValueAxis, framePlot, textWidth, tooSmall, FONT, type RenderProps,
} from './svgParts';

export const MEAN_COLOR = '#e15759';
export const MEDIAN_COLOR = '#59a14f';
export const STD_COLOR = '#f28e2b';

export function Histogram({ model, cfg, width: W, height: H, actions, hasSelection }: RenderProps<HistModel>) {
  const ymax = useMemo(() => niceTicks(0, Math.max(1, ...model.bins.map((b) => b.count)), 6), [model]);
  const lo = model.bins[0].x0;
  const hi = model.bins[model.bins.length - 1].x1;
  const xt = useMemo(() => niceTicks(lo, hi, 7, false), [lo, hi]);
  const showPanel = cfg.legend && W >= 560;
  const panelW = showPanel ? 168 : 0;
  const left = Math.max(...ymax.ticks.map((t) => textWidth(formatTick(t, ymax.step)))) + 8;
  const plot = framePlot(W, H, { title: cfg.showTitle, legendW: panelW, left, bottom: 22, xTitle: true, yTitle: true });
  if (tooSmall(plot)) return null;
  const xs = linearScale([lo, hi], [plot.x, plot.x + plot.w]);
  const ys = linearScale([ymax.min, ymax.max], [plot.y + plot.h, plot.y]);
  const fmtX = model.log ? (t: number) => formatTick(10 ** t, 10 ** t < 10 ? 0.1 : 1) : undefined;

  const s = model.stats;
  const lines: Array<{ key: string; x: number; color: string; label: string; dashed?: boolean }> = [];
  if (cfg.showMean && model.meanX !== null) lines.push({ key: 'mean', x: model.meanX, color: MEAN_COLOR, label: `Mean ${formatValue(s.mean)}` });
  if (cfg.showMedian && model.medianX !== null) lines.push({ key: 'median', x: model.medianX, color: MEDIAN_COLOR, label: `Median ${formatValue(s.median)}`, dashed: true });
  const std = cfg.showStd && model.stdX ? model.stdX : null;

  const rows: Array<[string, string]> = [
    ['Count', formatValue(s.n)], ['Min', formatValue(s.min)], ['Max', formatValue(s.max)],
    ['Mean', formatValue(s.mean)], ['Median', formatValue(s.median)], ['Std dev', formatValue(s.std)],
  ];
  const panelX = plot.x + plot.w + 18;

  return (
    <>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      <AxisTitles plot={plot} W={W} H={H} x={cfg.xTitle || model.xTitle} y={cfg.yTitle || 'Count'} />
      <ValueAxis side="left" plot={plot} scale={ys} ticks={ymax.ticks} step={ymax.step} grid={cfg.grid} />
      <ValueAxis side="bottom" plot={plot} scale={xs} ticks={xt.ticks} step={xt.step} grid={false} format={fmtX} />
      {std && (
        <rect className="tc-std-band" x={Math.max(plot.x, xs(std[0]))} y={plot.y} width={Math.max(0, Math.min(plot.x + plot.w, xs(std[1])) - Math.max(plot.x, xs(std[0])))} height={plot.h} fill={STD_COLOR} />
      )}
      <g>
        {model.bins.map((b, i) => {
          const x0 = xs(b.x0);
          const x1 = xs(b.x1);
          const w = Math.max(1, x1 - x0 - (x1 - x0 > 4 ? 1 : 0));
          const h = plot.y + plot.h - ys(b.count);
          const hs = b.count ? (b.sel / b.count) * h : 0;
          const lo0 = model.log ? 10 ** b.x0 : b.x0;
          const hi0 = model.log ? 10 ** b.x1 : b.x1;
          return (
            <g
              key={i}
              className="tc-mark"
              onClick={(e) => { e.stopPropagation(); actions.select(b.fids, e); }}
              onMouseMove={(e) => actions.tip(e, `${formatValue(lo0)} – ${formatValue(hi0)}`, [`Count: ${formatValue(b.count)}`, ...(b.sel ? [`Selected: ${formatValue(b.sel)}`] : [])])}
              onMouseLeave={actions.hideTip}
            >
              {/* invisible full-height hit area so tiny bars stay clickable */}
              <rect x={x0} y={plot.y} width={Math.max(1, x1 - x0)} height={plot.h} fill="transparent" />
              <rect x={x0 + 0.5} y={ys(b.count)} width={w} height={Math.max(0, h)} fill={cfg.color} fillOpacity={hasSelection && !b.sel ? 0.5 : 1} />
              {hs > 0 && <rect className="tc-sel-fill" x={x0 + 0.5} y={plot.y + plot.h - hs} width={w} height={hs} />}
            </g>
          );
        })}
      </g>
      {lines.map((l) => (
        <line key={l.key} x1={xs(l.x)} x2={xs(l.x)} y1={plot.y} y2={plot.y + plot.h} stroke={l.color} strokeWidth={1.6} strokeDasharray={l.dashed ? '5 3' : undefined} pointerEvents="none" />
      ))}
      {std && model.stdX && (
        <g pointerEvents="none" stroke={STD_COLOR} strokeWidth={1.2} strokeDasharray="2 3">
          {model.stdX.map((v, i) => (v >= lo && v <= hi ? <line key={i} x1={xs(v)} x2={xs(v)} y1={plot.y} y2={plot.y + plot.h} /> : null))}
        </g>
      )}
      {showPanel && (
        <g transform={`translate(${panelX} ${plot.y})`}>
          <text className="tc-legend-title" y={10}>Statistics</text>
          {rows.map(([k, v], i) => (
            <g key={k} transform={`translate(0 ${20 + i * 17})`}>
              <text className="tc-legend-detail" y={6} dy="0.34em">{k}</text>
              <text className="tc-legend-text" x={150} y={6} dy="0.34em" textAnchor="end">{v}</text>
            </g>
          ))}
          <g transform={`translate(0 ${24 + rows.length * 17 + 6})`}>
            <text className="tc-legend-title" y={10}>Overlays</text>
            {[
              ...(cfg.showMean && model.meanX !== null ? [{ label: 'Mean', color: MEAN_COLOR, dashed: false }] : []),
              ...(cfg.showMedian && model.medianX !== null ? [{ label: 'Median', color: MEDIAN_COLOR, dashed: true }] : []),
              ...(std ? [{ label: '± 1 std dev', color: STD_COLOR, dashed: true }] : []),
            ].map((o, i) => (
              <g key={o.label} transform={`translate(0 ${20 + i * 17})`}>
                <line x1={0} x2={12} y1={6} y2={6} stroke={o.color} strokeWidth={2} strokeDasharray={o.dashed ? '4 2' : undefined} />
                <text className="tc-legend-text" x={18} y={6} dy="0.34em">{o.label}</text>
              </g>
            ))}
          </g>
        </g>
      )}
      {!showPanel && lines.length > 0 && (
        <text className="tc-legend-detail" x={plot.x + plot.w - 4} y={plot.y + FONT + 2} textAnchor="end">
          {lines.map((l) => l.label).join('   ')}
        </text>
      )}
    </>
  );
}
