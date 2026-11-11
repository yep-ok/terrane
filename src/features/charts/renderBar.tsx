// Bar (vertical / horizontal, grouped / stacked) and box-plot renderers.
import { useMemo } from 'react';
import type { BarModel, BoxModel } from './model';
import { formatTick, formatValue, linearScale, niceTicks } from './stats';
import {
  AxisTitles, BandAxis, Legend, ValueAxis, bandLabelSpace, framePlot, legendWidth, textWidth, tooSmall, Title, FONT,
  type LegendEntry, type Plot, type RenderProps,
} from './svgParts';

function valueLeftMargin(ticks: number[], step: number) {
  return Math.max(...ticks.map((t) => textWidth(formatTick(t, step)))) + 8;
}

// ---------- bar ----------

export function BarChart({ model, cfg, width: W, height: H, actions, hasSelection }: RenderProps<BarModel>) {
  const horizontal = model.horizontal;
  const split = model.series.length > 0;
  const nCats = model.cats.length;

  // value domain
  const { ticks, vmin, vmax, step } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const c of model.cats) {
      if (model.stacked) {
        let pos = 0;
        let neg = 0;
        for (const s of c.segs) (s.value >= 0 ? (pos += s.value) : (neg += s.value));
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      } else {
        for (const s of c.segs) {
          hi = Math.max(hi, s.value, s.sel);
          lo = Math.min(lo, s.value);
        }
      }
    }
    const t = niceTicks(lo, hi === 0 && lo === 0 ? 1 : hi, 6);
    return { ticks: t.ticks, vmin: t.min, vmax: t.max, step: t.step };
  }, [model]);

  const legend: LegendEntry[] = split ? model.series.map((s) => ({ label: s.label, color: s.color, fids: s.fids })) : [];
  const lw = cfg.legend ? legendWidth(legend, W) : 0;
  const labels = model.cats.map((c) => c.label);

  // first pass to know band size for the bottom labels
  const roughW = Math.max(40, W - 120 - lw);
  const bottomSpace = !horizontal ? bandLabelSpace(labels, 'bottom', roughW / Math.max(1, nCats)) : { size: 22, rotate: false, max: 16 };
  const leftSpace = horizontal ? bandLabelSpace(labels, 'left', 20) : { size: valueLeftMargin(ticks, step), rotate: false, max: 22 };
  const plot = framePlot(W, H, {
    title: cfg.showTitle, legendW: lw, left: leftSpace.size, bottom: horizontal ? 22 : bottomSpace.size, xTitle: true, yTitle: true,
  });
  if (tooSmall(plot)) return null;
  const rot = !horizontal && labels.length ? bandLabelSpace(labels, 'bottom', plot.w / nCats) : bottomSpace;

  const bandSize = (horizontal ? plot.h : plot.w) / nCats;
  const vs = horizontal ? linearScale([vmin, vmax], [plot.x, plot.x + plot.w]) : linearScale([vmin, vmax], [plot.y + plot.h, plot.y]);
  const catPos = (i: number) => (horizontal ? plot.y : plot.x) + i * bandSize;
  const pad = Math.min(bandSize * 0.18, 14);
  const rectAt = (c0: number, c1: number, v0: number, v1: number) =>
    horizontal
      ? { x: Math.min(vs(v0), vs(v1)), y: c0, width: Math.abs(vs(v1) - vs(v0)), height: Math.max(0, c1 - c0) }
      : { x: c0, y: Math.min(vs(v0), vs(v1)), width: Math.max(0, c1 - c0), height: Math.abs(vs(v1) - vs(v0)) };

  const showLabels = !split && (horizontal ? bandSize >= 14 : bandSize >= 34);
  const k = split && !model.stacked ? model.series.length : 1;
  const tipFor = (e: React.MouseEvent, c: BarModel['cats'][number], segIdx: number) => {
    const s = c.segs[segIdx];
    const rows = split ? [`${s.series ? model.series.find((x) => x.key === s.series)?.label : ''}: ${formatValue(s.value)}`, `Category total: ${formatValue(c.total)}`] : [`${model.valueTitle}: ${formatValue(s.value)}`];
    rows.push(`${formatValue(s.count)} feature${s.count === 1 ? '' : 's'}${s.selCount ? `, ${formatValue(s.selCount)} selected` : ''}`);
    actions.tip(e, c.label, rows);
  };

  const marks = model.cats.map((c, i) => {
    const c0 = catPos(i) + pad;
    const c1 = catPos(i) + bandSize - pad;
    let pos = 0;
    let neg = 0;
    return c.segs.map((s, si) => {
      let r: ReturnType<typeof rectAt>;
      let o: ReturnType<typeof rectAt> | null = null;
      const color = split ? model.series.find((x) => x.key === s.series)!.color : c.color;
      if (model.stacked) {
        const base = s.value >= 0 ? pos : neg;
        if (s.value >= 0) pos += s.value;
        else neg += s.value;
        r = rectAt(c0, c1, base, base + s.value);
        if (s.sel) o = rectAt(c0, c1, base, base + (s.value >= 0 ? 1 : -1) * Math.min(Math.abs(s.sel), Math.abs(s.value)));
      } else {
        const w = (c1 - c0) / k;
        const a = c0 + si * w + (k > 1 ? 0.5 : 0);
        const b = a + w - (k > 1 ? 1 : 0);
        r = rectAt(a, b, 0, s.value);
        if (s.sel) o = rectAt(a, b, 0, s.sel);
      }
      return { key: `${c.key}|${s.series}`, r, o, color, c, si, s };
    });
  });

  return (
    <>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      <AxisTitles plot={plot} W={W} H={H} x={cfg.xTitle || (horizontal ? model.valueTitle : model.catTitle)} y={cfg.yTitle || (horizontal ? model.catTitle : model.valueTitle)} />
      <ValueAxis side={horizontal ? 'bottom' : 'left'} plot={plot} scale={vs} ticks={ticks} step={step} grid={cfg.grid} />
      {vmin < 0 && vmax > 0 && (
        <line className="tc-zero" {...(horizontal ? { x1: vs(0), x2: vs(0), y1: plot.y, y2: plot.y + plot.h } : { x1: plot.x, x2: plot.x + plot.w, y1: vs(0), y2: vs(0) })} />
      )}
      <BandAxis
        side={horizontal ? 'left' : 'bottom'}
        plot={plot}
        bands={model.cats.map((c, i) => ({ center: catPos(i) + bandSize / 2, label: c.label, fids: c.fids }))}
        bandSize={bandSize}
        rotate={rot.rotate}
        max={rot.max}
        onClick={(b, e) => actions.select(b.fids ?? [], e)}
      />
      <g>
        {marks.flat().map((m) => (
          <g
            key={m.key}
            className="tc-mark"
            onClick={(e) => { e.stopPropagation(); actions.select(m.s.fids, e); }}
            onMouseMove={(e) => tipFor(e, m.c, m.si)}
            onMouseLeave={actions.hideTip}
          >
            <rect {...m.r} fill={m.color} fillOpacity={hasSelection && !m.s.selCount ? 0.45 : 1} rx={1.5} />
            {m.o && <rect {...m.o} className="tc-sel-fill" rx={1.5} />}
          </g>
        ))}
      </g>
      {showLabels &&
        model.cats.map((c, i) => {
          const s = c.segs[0];
          const e = vs(s.value);
          const label = formatValue(s.value);
          if (horizontal) {
            const room = plot.x + plot.w - e;
            const inside = room < textWidth(label) + 8;
            return <text key={c.key} className="tc-datalabel" x={inside ? e - 4 : e + 4} y={catPos(i) + bandSize / 2} dy="0.32em" textAnchor={inside ? 'end' : 'start'} style={inside ? { fill: '#fff' } : undefined}>{label}</text>;
          }
          const room = e - plot.y;
          const inside = room < FONT + 6;
          return <text key={c.key} className="tc-datalabel" x={catPos(i) + bandSize / 2} y={inside ? e + 4 : e - 4} dy={inside ? '0.9em' : 0} textAnchor="middle" style={inside ? { fill: '#fff' } : undefined}>{label}</text>;
        })}
      {cfg.legend && lw > 0 && <Legend entries={legend} x={plot.x + plot.w + 16} y={plot.y} maxHeight={plot.h} title={cfg.splitField} onPick={(f, e) => actions.select(f, e)} />}
    </>
  );
}

// ---------- box plot ----------

export function BoxPlot({ model, cfg, width: W, height: H, actions }: RenderProps<BoxModel>) {
  const horizontal = model.horizontal;
  const n = model.boxes.length;
  const { ticks, vmin, vmax, step } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const b of model.boxes) {
      lo = Math.min(lo, b.stats.min);
      hi = Math.max(hi, b.stats.max);
    }
    const t = niceTicks(lo, hi, 6);
    return { ticks: t.ticks, vmin: t.min, vmax: t.max, step: t.step };
  }, [model]);
  const labels = model.boxes.map((b) => b.label);
  const lw = 0;
  const roughW = Math.max(40, W - 120);
  const bottomSpace = !horizontal ? bandLabelSpace(labels, 'bottom', roughW / Math.max(1, n)) : { size: 22, rotate: false, max: 16 };
  const leftSpace = horizontal ? bandLabelSpace(labels, 'left', 20) : { size: valueLeftMargin(ticks, step), rotate: false, max: 22 };
  const plot: Plot = framePlot(W, H, { title: cfg.showTitle, legendW: lw, left: leftSpace.size, bottom: horizontal ? 22 : bottomSpace.size, xTitle: true, yTitle: true });
  if (tooSmall(plot)) return null;
  const rot = !horizontal ? bandLabelSpace(labels, 'bottom', plot.w / n) : bottomSpace;
  const bandSize = (horizontal ? plot.h : plot.w) / n;
  const vs = horizontal ? linearScale([vmin, vmax], [plot.x, plot.x + plot.w]) : linearScale([vmin, vmax], [plot.y + plot.h, plot.y]);
  const cs = (i: number) => (horizontal ? plot.y : plot.x) + (i + 0.5) * bandSize;
  const half = Math.min(bandSize * 0.3, 44);
  const P = (c: number, v: number): [number, number] => (horizontal ? [vs(v), c] : [c, vs(v)]);
  const seg = (c1: number, v1: number, c2: number, v2: number) => {
    const [x1, y1] = P(c1, v1);
    const [x2, y2] = P(c2, v2);
    return { x1, y1, x2, y2 };
  };

  const tip = (e: React.MouseEvent, b: BoxModel['boxes'][number]) =>
    actions.tip(e, b.label, [
      `n: ${formatValue(b.stats.n)}`,
      `Median: ${formatValue(b.stats.median)}`,
      `Q1 – Q3: ${formatValue(b.stats.q1)} – ${formatValue(b.stats.q3)}`,
      `Whiskers: ${formatValue(b.stats.lowerWhisker)} – ${formatValue(b.stats.upperWhisker)}`,
      `Mean: ${formatValue(b.stats.mean)}`,
      `Outliers: ${b.outliers.length}`,
    ]);

  return (
    <>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      <AxisTitles plot={plot} W={W} H={H} x={cfg.xTitle || (horizontal ? model.valueTitle : model.catTitle)} y={cfg.yTitle || (horizontal ? model.catTitle : model.valueTitle)} />
      <ValueAxis side={horizontal ? 'bottom' : 'left'} plot={plot} scale={vs} ticks={ticks} step={step} grid={cfg.grid} />
      <BandAxis
        side={horizontal ? 'left' : 'bottom'}
        plot={plot}
        bands={model.boxes.map((b, i) => ({ center: cs(i), label: b.label, fids: b.fids }))}
        bandSize={bandSize}
        rotate={rot.rotate}
        max={rot.max}
        onClick={(b, e) => actions.select(b.fids ?? [], e)}
      />
      {model.boxes.map((b, i) => {
        const c = cs(i);
        const s = b.stats;
        const [bx1, by1] = P(c - half, s.q3);
        const [bx2, by2] = P(c + half, s.q1);
        const rect = { x: Math.min(bx1, bx2), y: Math.min(by1, by2), width: Math.abs(bx2 - bx1), height: Math.max(1, Math.abs(by2 - by1)) };
        const [mx, my] = P(c, s.mean);
        const selAll = b.selCount > 0 && b.selCount === b.fids.length;
        return (
          <g key={b.key}>
            <g className="tc-mark" onClick={(e) => { e.stopPropagation(); actions.select(b.fids, e); }} onMouseMove={(e) => tip(e, b)} onMouseLeave={actions.hideTip}>
              <line {...seg(c, s.lowerWhisker, c, s.q1)} stroke={b.color} strokeWidth={1.5} />
              <line {...seg(c, s.q3, c, s.upperWhisker)} stroke={b.color} strokeWidth={1.5} />
              <line {...seg(c - half / 2, s.lowerWhisker, c + half / 2, s.lowerWhisker)} stroke={b.color} strokeWidth={1.5} />
              <line {...seg(c - half / 2, s.upperWhisker, c + half / 2, s.upperWhisker)} stroke={b.color} strokeWidth={1.5} />
              <rect {...rect} fill={b.color} fillOpacity={0.4} stroke={b.color} strokeWidth={1.5} rx={1} />
              <line {...seg(c - half, s.median, c + half, s.median)} stroke={b.color} strokeWidth={3} />
              <path className="tc-mean" d={`M${mx - 4} ${my}L${mx} ${my - 4}L${mx + 4} ${my}L${mx} ${my + 4}Z`} />
              {b.selCount > 0 && <rect {...rect} className="tc-sel-stroke" fill="none" strokeDasharray={selAll ? undefined : '4 3'} rx={1} />}
            </g>
            {b.outliers.map((o) => {
              const [ox, oy] = P(c, o.v);
              return (
                <circle
                  key={o.fid}
                  className={o.sel ? 'tc-mark tc-outlier sel' : 'tc-mark tc-outlier'}
                  cx={ox}
                  cy={oy}
                  r={o.sel ? 4 : 3}
                  fill={o.sel ? undefined : 'none'}
                  stroke={o.sel ? undefined : b.color}
                  strokeWidth={1.4}
                  onClick={(e) => { e.stopPropagation(); actions.select([o.fid], e); }}
                  onMouseMove={(e) => actions.tip(e, b.label, [`Outlier: ${formatValue(o.v)}`, `FID ${o.fid}`])}
                  onMouseLeave={actions.hideTip}
                />
              );
            })}
          </g>
        );
      })}
    </>
  );
}
