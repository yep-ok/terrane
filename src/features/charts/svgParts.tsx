// Shared SVG building blocks: frame layout, axes, titles, legend.
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { formatTick, truncate, type LinearScale } from './stats';
import type { ChartConfig } from './config';

export interface Plot {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Mods = { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean };

/** Callbacks a chart renderer uses to talk to the view (selection + tooltip). */
export interface ChartActions {
  select(fids: number[], e: Mods): void;
  clear(): void;
  tip(e: { clientX: number; clientY: number }, title: string, rows: string[]): void;
  hideTip(): void;
}

export interface RenderProps<M> {
  model: M;
  cfg: ChartConfig;
  width: number;
  height: number;
  actions: ChartActions;
  hasSelection: boolean;
}

export interface LegendEntry {
  label: string;
  color: string;
  /** Right-aligned detail ("12%"). */
  detail?: string;
  fids?: number[];
  dashed?: boolean;
  line?: boolean;
}

export const FONT = 11;
/** Approximate rendered width of a label in the chart font. */
export const textWidth = (s: string, px = FONT) => s.length * px * 0.58;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function legendWidth(entries: LegendEntry[], totalWidth: number): number {
  if (!entries.length || totalWidth < 400) return 0;
  const longest = Math.max(...entries.map((e) => Math.min(22, e.label.length) * FONT * 0.58 + (e.detail ? e.detail.length * FONT * 0.58 + 10 : 0)));
  return clamp(Math.ceil(longest + 34), 90, Math.min(230, totalWidth * 0.34));
}

/** Plot rectangle inside the SVG once margins for title, axes and legend are reserved. */
export function framePlot(
  W: number, H: number,
  o: { title: boolean; legendW: number; left: number; bottom: number; xTitle?: boolean; yTitle?: boolean; right?: number },
): Plot {
  const top = o.title ? 36 : 14;
  const left = o.left + (o.yTitle ? 20 : 0) + 10;
  const bottom = o.bottom + (o.xTitle ? 20 : 0) + 10;
  const right = (o.right ?? 14) + (o.legendW ? o.legendW + 6 : 0);
  return { x: left, y: top, w: Math.max(0, W - left - right), h: Math.max(0, H - top - bottom) };
}

export function tooSmall(p: Plot) {
  return p.w < 50 || p.h < 40;
}

// ---------- title / axis titles ----------

export function Title({ text, plot, width }: { text: string; plot: Plot; width: number }) {
  const max = Math.floor(Math.max(width - 30, 60) / (13 * 0.6));
  return (
    <text className="tc-title" x={plot.x + plot.w / 2} y={22} textAnchor="middle">
      {truncate(text, max)}
    </text>
  );
}

export function AxisTitles({ plot, W, H, x, y }: { plot: Plot; W: number; H: number; x?: string; y?: string }) {
  void W;
  return (
    <g className="tc-axis-title">
      {x && (
        <text x={plot.x + plot.w / 2} y={H - 8} textAnchor="middle">
          {truncate(x, Math.floor(plot.w / 6.4))}
        </text>
      )}
      {y && (
        <text transform={`translate(12 ${plot.y + plot.h / 2}) rotate(-90)`} textAnchor="middle">
          {truncate(y, Math.floor(plot.h / 6.4))}
        </text>
      )}
    </g>
  );
}

// ---------- axes ----------

export function ValueAxis({
  side, plot, scale, ticks, step, grid, format,
}: {
  side: 'left' | 'bottom'; plot: Plot; scale: LinearScale; ticks: number[]; step: number; grid: boolean; format?: (v: number) => string;
}) {
  const [d0, d1] = scale.domain;
  const lo = Math.min(d0, d1);
  const hi = Math.max(d0, d1);
  const eps = (hi - lo) * 1e-6;
  const visible = ticks.filter((t) => t >= lo - eps && t <= hi + eps);
  const fmt = format ?? ((v: number) => formatTick(v, step));
  if (side === 'left') {
    return (
      <g>
        {visible.map((t) => {
          const y = scale(t);
          return (
            <g key={t}>
              {grid && <line className="tc-grid" x1={plot.x} x2={plot.x + plot.w} y1={y} y2={y} />}
              <line className="tc-axis" x1={plot.x - 4} x2={plot.x} y1={y} y2={y} />
              <text className="tc-tick" x={plot.x - 7} y={y} dy="0.32em" textAnchor="end">{fmt(t)}</text>
            </g>
          );
        })}
        <line className="tc-axis" x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.h} />
      </g>
    );
  }
  const yb = plot.y + plot.h;
  return (
    <g>
      {visible.map((t) => {
        const x = scale(t);
        return (
          <g key={t}>
            {grid && <line className="tc-grid" x1={x} x2={x} y1={plot.y} y2={yb} />}
            <line className="tc-axis" x1={x} x2={x} y1={yb} y2={yb + 4} />
            <text className="tc-tick" x={x} y={yb + 8} dy="0.9em" textAnchor="middle">{fmt(t)}</text>
          </g>
        );
      })}
      <line className="tc-axis" x1={plot.x} x2={plot.x + plot.w} y1={yb} y2={yb} />
    </g>
  );
}

export interface Band {
  center: number;
  label: string;
  fids?: number[];
}

/** Labels for a categorical axis; rotates / thins labels when crowded. Returns also the space they need. */
export function bandLabelSpace(labels: string[], side: 'left' | 'bottom', bandSize: number): { size: number; rotate: boolean; max: number } {
  const max = side === 'left' ? 22 : 16;
  const longest = Math.max(0, ...labels.map((l) => Math.min(max, l.length)));
  if (side === 'left') return { size: clamp(longest * FONT * 0.58 + 12, 40, 170), rotate: false, max };
  const flat = longest * FONT * 0.58 + 6 <= bandSize;
  return { size: flat ? 22 : clamp(longest * 4 + 26, 30, 100), rotate: !flat, max };
}

export function BandAxis({
  side, plot, bands, bandSize, onClick, rotate, max,
}: {
  side: 'left' | 'bottom'; plot: Plot; bands: Band[]; bandSize: number; rotate: boolean; max: number;
  onClick?: (b: Band, e: ReactMouseEvent) => void;
}) {
  const lineH = FONT + 3;
  const every = side === 'bottom' && rotate ? Math.max(1, Math.ceil(lineH / bandSize)) : side === 'left' ? Math.max(1, Math.ceil(lineH / bandSize)) : bandSize < 8 ? Math.ceil(8 / bandSize) : 1;
  return (
    <g>
      {side === 'left' ? (
        <line className="tc-axis" x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.h} />
      ) : (
        <line className="tc-axis" x1={plot.x} x2={plot.x + plot.w} y1={plot.y + plot.h} y2={plot.y + plot.h} />
      )}
      {bands.map((b, i) => {
        if (i % every) return null;
        const text = truncate(b.label, max);
        const handlers = onClick ? { onClick: (e: ReactMouseEvent) => { e.stopPropagation(); onClick(b, e); }, className: 'tc-tick tc-clickable' } : { className: 'tc-tick' };
        if (side === 'left')
          return (
            <text key={i} {...handlers} x={plot.x - 7} y={b.center} dy="0.32em" textAnchor="end">
              {text}
              {text !== b.label && <title>{b.label}</title>}
            </text>
          );
        const y = plot.y + plot.h + 8;
        return rotate ? (
          <text key={i} {...handlers} transform={`translate(${b.center + 3} ${y}) rotate(-40)`} dy="0.3em" textAnchor="end">
            {text}
            {text !== b.label && <title>{b.label}</title>}
          </text>
        ) : (
          <text key={i} {...handlers} x={b.center} y={y} dy="0.9em" textAnchor="middle">
            {text}
            {text !== b.label && <title>{b.label}</title>}
          </text>
        );
      })}
    </g>
  );
}

// ---------- legend ----------

export function Legend({
  entries, x, y, maxHeight, onPick, title,
}: {
  entries: LegendEntry[]; x: number; y: number; maxHeight: number; title?: string;
  onPick?: (fids: number[], e: ReactMouseEvent) => void;
}) {
  const row = 17;
  const head = title ? 16 : 0;
  const capacity = Math.max(1, Math.floor((maxHeight - head) / row));
  const shown = entries.length > capacity ? entries.slice(0, Math.max(1, capacity - 1)) : entries;
  const more = entries.length - shown.length;
  const labelMax = 22;
  return (
    <g className="tc-legend" transform={`translate(${x} ${y})`}>
      {title && <text className="tc-legend-title" y={10}>{truncate(title, 24)}</text>}
      {shown.map((e, i) => (
        <g
          key={i}
          transform={`translate(0 ${head + i * row})`}
          className={e.fids && onPick ? 'tc-clickable' : undefined}
          onClick={e.fids && onPick ? (ev) => { ev.stopPropagation(); onPick(e.fids!, ev); } : undefined}
        >
          {e.line ? (
            <line x1={0} x2={11} y1={6} y2={6} stroke={e.color} strokeWidth={2} strokeDasharray={e.dashed ? '4 2' : undefined} />
          ) : (
            <rect width={11} height={11} y={1} rx={2} fill={e.color} />
          )}
          <text className="tc-legend-text" x={17} y={6} dy="0.34em">
            {truncate(e.label, labelMax)}
            {e.label.length > labelMax && <title>{e.label}</title>}
          </text>
          {e.detail && <text className="tc-legend-detail" x={17 + Math.min(labelMax, e.label.length) * FONT * 0.58 + 8} y={6} dy="0.34em">{e.detail}</text>}
        </g>
      ))}
      {more > 0 && <text className="tc-legend-detail" x={0} y={head + shown.length * row + 10}>+{more} more</text>}
    </g>
  );
}

export function EmptyPlot({ plot, text }: { plot: Plot; text: string }): ReactNode {
  return (
    <text className="tc-tick" x={plot.x + plot.w / 2} y={plot.y + plot.h / 2} textAnchor="middle">
      {text}
    </text>
  );
}
