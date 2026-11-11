// Pie / donut renderer.
import type { PieModel } from './model';
import { formatPercent, formatValue } from './stats';
import { Legend, Title, framePlot, legendWidth, tooSmall, type LegendEntry, type RenderProps } from './svgParts';

const TAU = Math.PI * 2;

function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, TAU - 1e-4);
  const e = a0 + sweep;
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  const large = sweep > Math.PI ? 1 : 0;
  if (r0 <= 0.5) return `M${cx} ${cy}L${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, e)}Z`;
  return `M${p(r1, a0)}A${r1} ${r1} 0 ${large} 1 ${p(r1, e)}L${p(r0, e)}A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

export function PieChart({ model, cfg, width: W, height: H, actions, hasSelection }: RenderProps<PieModel>) {
  const legend: LegendEntry[] = model.slices.map((s) => ({ label: s.label, color: s.color, detail: formatPercent(s.value / model.sum), fids: s.fids }));
  const lw = cfg.legend ? legendWidth(legend, W) : 0;
  const plot = framePlot(W, H, { title: cfg.showTitle, legendW: lw, left: 0, bottom: 0 });
  if (tooSmall(plot)) return null;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const R = Math.max(10, Math.min(plot.w, plot.h) / 2 - 4);
  const r0 = cfg.donut ? R * 0.58 : 0;

  let angle = 0;
  const slices = model.slices.map((s) => {
    const a0 = angle;
    const a1 = angle + (s.value / model.sum) * TAU;
    angle = a1;
    return { s, a0, a1 };
  });

  return (
    <>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      {slices.map(({ s, a0, a1 }) => {
        const frac = Math.min(1, s.sel / s.value);
        const mid = (a0 + a1) / 2;
        const lr = r0 ? (r0 + R) / 2 : R * 0.64;
        return (
          <g
            key={s.key}
            className="tc-mark"
            onClick={(e) => { e.stopPropagation(); actions.select(s.fids, e); }}
            onMouseMove={(e) =>
              actions.tip(e, s.label, [
                `${model.valueTitle}: ${formatValue(s.value)}`,
                `Share: ${formatPercent(s.value / model.sum)}`,
                `${formatValue(s.count)} feature${s.count === 1 ? '' : 's'}${s.selCount ? `, ${formatValue(s.selCount)} selected` : ''}`,
              ])
            }
            onMouseLeave={actions.hideTip}
          >
            <path d={arcPath(cx, cy, r0, R, a0, a1)} fill={s.color} fillOpacity={hasSelection && !s.selCount ? 0.45 : 1} className="tc-slice" />
            {s.sel > 0 && frac > 0 && <path d={arcPath(cx, cy, r0, Math.sqrt(r0 * r0 + frac * (R * R - r0 * r0)), a0, a1)} className="tc-sel-fill" />}
            {cfg.sliceLabels && a1 - a0 > 0.3 && R > 60 && (
              <text className="tc-slice-label" x={cx + lr * Math.sin(mid)} y={cy - lr * Math.cos(mid)} textAnchor="middle" dy="0.34em">
                {formatPercent(s.value / model.sum)}
              </text>
            )}
          </g>
        );
      })}
      {cfg.donut && R > 50 && (
        <g pointerEvents="none">
          <text className="tc-tick" x={cx} y={cy - 6} textAnchor="middle">Total</text>
          <text className="tc-center-value" x={cx} y={cy + 12} textAnchor="middle">{formatValue(model.sum)}</text>
        </g>
      )}
      {cfg.legend && lw > 0 && <Legend entries={legend} x={plot.x + plot.w + 16} y={plot.y} maxHeight={plot.h} title={cfg.category} onPick={(f, e) => actions.select(f, e)} />}
    </>
  );
}
