// Scatter plot (colour-by, size-by, trend line, rectangle brush selection) and line chart renderers.
import { useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { LineModel, ScatterModel } from './model';
import { formatTick, formatTime, formatValue, linearScale, niceTicks, timeTicks } from './stats';
import {
  AxisTitles, Legend, Title, ValueAxis, framePlot, legendWidth, textWidth, tooSmall, FONT, type LegendEntry, type RenderProps,
} from './svgParts';

const MAX_CIRCLES = 3000;

interface Brush {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function sig(v: number): string {
  if (!Number.isFinite(v)) return '0';
  if (v === 0) return '0';
  const a = Math.abs(v);
  return a >= 1e5 || a < 1e-3 ? v.toExponential(2) : String(Number(v.toPrecision(3)));
}

export function ScatterPlot({ model, cfg, width: W, height: H, actions, hasSelection }: RenderProps<ScatterModel>) {
  const clipId = useId();
  const [brush, setBrush] = useState<Brush | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const ext = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of model.points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    const padX = (x1 - x0) * 0.03;
    const padY = (y1 - y0) * 0.03;
    return { x: niceTicks(x0 - padX, x1 + padX, 7), y: niceTicks(y0 - padY, y1 + padY, 6), x0, x1 };
  }, [model]);

  const legend: LegendEntry[] = model.groups.map((g) => ({ label: g.label, color: g.color, fids: g.fids }));
  const lw = cfg.legend ? legendWidth(legend, W) : 0;
  const left = Math.max(...ext.y.ticks.map((t) => textWidth(formatTick(t, ext.y.step)))) + 8;
  const plot = framePlot(W, H, { title: cfg.showTitle, legendW: lw, left, bottom: 22, xTitle: true, yTitle: true });
  const xs = linearScale([ext.x.min, ext.x.max], [plot.x, plot.x + plot.w]);
  const ys = linearScale([ext.y.min, ext.y.max], [plot.y + plot.h, plot.y]);

  const rBase = cfg.pointSize;
  const sz = model.size;
  const radius = (s: number | null) => (sz && s !== null && sz.max > sz.min ? rBase * 0.6 + Math.sqrt((s - sz.min) / (sz.max - sz.min)) * rBase * 1.8 : rBase);
  const colorOf = (g: number) => (g >= 0 ? model.groups[g].color : cfg.color);

  const local = (e: RPointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const nearest = (lx: number, ly: number) => {
    const px = lx + plot.x;
    const py = ly + plot.y;
    let best: ScatterModel['points'][number] | null = null;
    let bd = Infinity;
    for (const p of model.points) {
      const dx = xs(p.x) - px;
      const dy = ys(p.y) - py;
      const d = dx * dx + dy * dy;
      const r = radius(p.s) + 4;
      if (d <= r * r && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  const tipFor = (e: { clientX: number; clientY: number }, p: ScatterModel['points'][number]) => {
    const rows = [`${model.xTitle}: ${formatValue(p.x)}`, `${model.yTitle}: ${formatValue(p.y)}`];
    if (p.g >= 0) rows.push(`${cfg.colorField}: ${model.groups[p.g].label}`);
    if (p.s !== null) rows.push(`${cfg.sizeField}: ${formatValue(p.s)}`);
    actions.tip(e, `Feature ${p.fid}`, rows);
  };

  const onDown = (e: RPointerEvent<SVGRectElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const l = local(e);
    drag.current = l;
    setBrush({ x0: l.x, y0: l.y, x1: l.x, y1: l.y });
    actions.hideTip();
  };
  const onMove = (e: RPointerEvent<SVGRectElement>) => {
    const l = local(e);
    if (drag.current) {
      setBrush({ x0: drag.current.x, y0: drag.current.y, x1: l.x, y1: l.y });
      return;
    }
    const p = nearest(l.x, l.y);
    if (p) tipFor(e, p);
    else actions.hideTip();
  };
  const onUp = (e: RPointerEvent<SVGRectElement>) => {
    const d = drag.current;
    drag.current = null;
    setBrush(null);
    if (!d) return;
    const l = local(e);
    if (Math.hypot(l.x - d.x, l.y - d.y) < 4) {
      const p = nearest(l.x, l.y);
      if (p) actions.select([p.fid], e);
      else if (!(e.ctrlKey || e.shiftKey || e.metaKey)) actions.clear();
      return;
    }
    const xa = Math.min(d.x, l.x) + plot.x;
    const xb = Math.max(d.x, l.x) + plot.x;
    const ya = Math.min(d.y, l.y) + plot.y;
    const yb = Math.max(d.y, l.y) + plot.y;
    const fids: number[] = [];
    for (const p of model.points) {
      const px = xs(p.x);
      const py = ys(p.y);
      if (px >= xa && px <= xb && py >= ya && py <= yb) fids.push(p.fid);
    }
    actions.select(fids, e);
  };

  // draw order: unselected first, selected on top
  const dimmed = hasSelection;
  const circles = model.points.length <= MAX_CIRCLES;
  const ordered = useMemo(() => (circles ? [...model.points].sort((a, b) => Number(a.sel) - Number(b.sel)) : []), [model, circles]);

  const pathLayers = useMemo(() => {
    if (circles) return null;
    const groups = new Map<string, { color: string; r: number; sel: boolean; d: string[] }>();
    for (const p of model.points) {
      const r = Math.round(radius(p.s) * 2) / 2;
      const color = colorOf(p.g);
      const key = `${color}|${r}|${p.sel}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { color, r, sel: p.sel, d: [] }));
      g.d.push(`M${xs(p.x).toFixed(1)} ${ys(p.y).toFixed(1)}h0`);
    }
    return [...groups.values()].sort((a, b) => Number(a.sel) - Number(b.sel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circles, model, cfg.color, cfg.pointSize, plot.x, plot.y, plot.w, plot.h, ext]);

  if (tooSmall(plot)) return null;
  const t = model.trend;
  const trendY = (x: number) => (t ? t.slope * x + t.intercept : 0);
  const eq = t ? `y = ${sig(t.slope)}x ${t.intercept < 0 ? '−' : '+'} ${sig(Math.abs(t.intercept))}    R² = ${t.r2.toFixed(3)}` : '';

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={plot.x} y={plot.y} width={plot.w} height={plot.h} />
        </clipPath>
      </defs>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      <AxisTitles plot={plot} W={W} H={H} x={cfg.xTitle || model.xTitle} y={cfg.yTitle || model.yTitle} />
      <ValueAxis side="left" plot={plot} scale={ys} ticks={ext.y.ticks} step={ext.y.step} grid={cfg.grid} />
      <ValueAxis side="bottom" plot={plot} scale={xs} ticks={ext.x.ticks} step={ext.x.step} grid={cfg.grid} />
      <g clipPath={`url(#${clipId})`}>
        {circles
          ? ordered.map((p) => (
              <circle
                key={p.fid}
                cx={xs(p.x)}
                cy={ys(p.y)}
                r={p.sel ? radius(p.s) + 0.8 : radius(p.s)}
                fill={colorOf(p.g)}
                fillOpacity={dimmed && !p.sel ? 0.3 : 0.78}
                className={p.sel ? 'tc-pt sel' : 'tc-pt'}
              />
            ))
          : pathLayers!.map((g, i) => (
              <g key={i}>
                {g.sel && <path d={g.d.join('')} stroke="var(--selection)" strokeWidth={g.r * 2 + 3} strokeLinecap="round" fill="none" />}
                <path d={g.d.join('')} stroke={g.color} strokeWidth={g.r * 2} strokeLinecap="round" fill="none" strokeOpacity={dimmed && !g.sel ? 0.3 : 0.78} />
              </g>
            ))}
        {t && <line className="tc-trend" x1={xs(ext.x0)} y1={ys(trendY(ext.x0))} x2={xs(ext.x1)} y2={ys(trendY(ext.x1))} />}
      </g>
      {t && (
        <g pointerEvents="none">
          <rect className="tc-badge" x={plot.x + 8} y={plot.y + 6} width={textWidth(eq) + 14} height={FONT + 10} rx={3} />
          <text className="tc-badge-text" x={plot.x + 15} y={plot.y + 6 + (FONT + 10) / 2} dy="0.34em">{eq}</text>
        </g>
      )}
      {brush && <rect className="tc-brush" x={Math.min(brush.x0, brush.x1) + plot.x} y={Math.min(brush.y0, brush.y1) + plot.y} width={Math.abs(brush.x1 - brush.x0)} height={Math.abs(brush.y1 - brush.y0)} pointerEvents="none" />}
      <rect
        className="tc-surface"
        x={plot.x} y={plot.y} width={plot.w} height={plot.h}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; setBrush(null); }}
        onPointerLeave={() => { if (!drag.current) actions.hideTip(); }}
      />
      {cfg.legend && lw > 0 && <Legend entries={legend} x={plot.x + plot.w + 16} y={plot.y} maxHeight={plot.h} title={cfg.colorField} onPick={(f, e) => actions.select(f, e)} />}
    </>
  );
}

// ---------- line ----------

export function LineChart({ model, cfg, width: W, height: H, actions }: RenderProps<LineModel>) {
  const clipId = useId();
  const [hover, setHover] = useState<{ s: number; i: number } | null>(null);

  const ext = useMemo(() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const s of model.series)
      for (const p of s.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
    if (y0 >= 0 && y0 <= y1 * 0.6) y0 = 0;
    const px = x1 === x0 ? 1 : (x1 - x0) * 0.03;
    const py = (y1 - y0) * 0.05;
    const xd: [number, number] = [x0 - px, x1 + px];
    const xt = model.xIsDate ? timeTicks(xd[0], xd[1], 7) : niceTicks(xd[0], xd[1], 7, false);
    return { xd, xt, y: niceTicks(y0, y1 + py, 6) };
  }, [model]);

  const legend: LegendEntry[] = model.series.map((s) => ({ label: s.label, color: s.color, line: true }));
  const lw = cfg.legend && model.series.length > 1 ? legendWidth(legend, W) : 0;
  const left = Math.max(...ext.y.ticks.map((t) => textWidth(formatTick(t, ext.y.step)))) + 8;
  const plot = framePlot(W, H, { title: cfg.showTitle, legendW: lw, left, bottom: 22, xTitle: true, yTitle: true });
  if (tooSmall(plot)) return null;
  const xs = linearScale(ext.xd, [plot.x, plot.x + plot.w]);
  const ys = linearScale([ext.y.min, ext.y.max], [plot.y + plot.h, plot.y]);
  const total = model.series.reduce((n, s) => n + s.pts.length, 0);
  const showMarkers = cfg.markers && total <= 400;
  const fmtX = model.xIsDate ? (v: number) => formatTime(v, ext.xt.step) : undefined;

  const find = (e: RPointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left + plot.x;
    const py = e.clientY - r.top + plot.y;
    let best: { s: number; i: number } | null = null;
    let bd = 22 * 22;
    model.series.forEach((s, si) =>
      s.pts.forEach((p, i) => {
        const dx = xs(p.x) - px;
        const dy = ys(p.y) - py;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = { s: si, i };
        }
      }),
    );
    return best as { s: number; i: number } | null;
  };
  const xLabel = (x: number) => (model.xIsDate ? new Date(x).toISOString().slice(0, 10) : formatValue(x));

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={plot.x - 6} y={plot.y - 6} width={plot.w + 12} height={plot.h + 12} />
        </clipPath>
      </defs>
      {cfg.showTitle && <Title text={model.title} plot={plot} width={W} />}
      <AxisTitles plot={plot} W={W} H={H} x={cfg.xTitle || model.xTitle} y={cfg.yTitle || model.yTitle} />
      <ValueAxis side="left" plot={plot} scale={ys} ticks={ext.y.ticks} step={ext.y.step} grid={cfg.grid} />
      <ValueAxis side="bottom" plot={plot} scale={xs} ticks={ext.xt.ticks} step={ext.xt.step} grid={cfg.grid} format={fmtX} />
      <g clipPath={`url(#${clipId})`}>
        {model.series.map((s) => (
          <path key={s.key} d={s.pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x).toFixed(1)} ${ys(p.y).toFixed(1)}`).join('')} fill="none" stroke={s.color} strokeWidth={1.9} strokeLinejoin="round" />
        ))}
        {model.series.map((s) =>
          s.pts.map((p, i) => {
            const sel = p.selCount > 0;
            if (!showMarkers && !sel) return null;
            return <circle key={`${s.key}${i}`} cx={xs(p.x)} cy={ys(p.y)} r={sel ? 4.5 : 3} fill={s.color} className={sel ? 'tc-pt sel' : 'tc-pt-line'} />;
          }),
        )}
        {hover && (() => {
          const s = model.series[hover.s];
          const p = s.pts[hover.i];
          return (
            <g pointerEvents="none">
              <line className="tc-guide" x1={xs(p.x)} x2={xs(p.x)} y1={plot.y} y2={plot.y + plot.h} />
              <circle cx={xs(p.x)} cy={ys(p.y)} r={5} fill={s.color} className="tc-hover-dot" />
            </g>
          );
        })()}
      </g>
      <rect
        className="tc-surface"
        x={plot.x} y={plot.y} width={plot.w} height={plot.h}
        onPointerMove={(e) => {
          const h = find(e);
          setHover(h);
          if (h) {
            const s = model.series[h.s];
            const p = s.pts[h.i];
            actions.tip(e, xLabel(p.x), [`${s.label}: ${formatValue(p.y)}`, `${formatValue(p.fids.length)} feature${p.fids.length === 1 ? '' : 's'}${p.selCount ? `, ${formatValue(p.selCount)} selected` : ''}`]);
          } else actions.hideTip();
        }}
        onPointerLeave={() => { setHover(null); actions.hideTip(); }}
        onClick={(e) => {
          const h = find(e as unknown as RPointerEvent<SVGRectElement>);
          if (h) actions.select(model.series[h.s].pts[h.i].fids, e);
          else if (!(e.ctrlKey || e.shiftKey || e.metaKey)) actions.clear();
        }}
      />
      {lw > 0 && <Legend entries={legend} x={plot.x + plot.w + 16} y={plot.y} maxHeight={plot.h} />}
    </>
  );
}
