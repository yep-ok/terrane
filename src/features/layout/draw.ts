// Canvas renderer for layout elements other than map content. The same functions draw the
// on-screen element canvases and the export, so print output matches the screen. Layout
// (line breaks, legend flow, scale-bar divisions) is computed in millimetres with a
// resolution-independent text measurer; only the final drawing depends on `k` (px per mm).
import type { FeatureLayer, GeomType, LayoutDoc, LayoutElement, SymbolDef } from '../../core/types';
import { getDataset } from '../../core/data';
import { getMap, isLayerVisible } from '../../core/store';
import { legendFor } from '../symbology/legend';
import { formatDistance, formatScale, niceScaleBar, NOMINAL_PX_PER_MM, ptToMm } from './geometry';
import { frameScale, resolveFrame, resolveText } from './scale';
import type {
  ImageProps, LegendProps, MapFrameProps, NorthArrowDesign, NorthArrowProps, RectProps, ScaleBarProps, TextProps,
} from './types';
import { DEFAULT_FONT } from './types';

export interface DrawEnv {
  layout: LayoutDoc;
  /** Device pixels per millimetre. */
  k: number;
  /** Called when an image needed for drawing finishes loading (screen repaint). */
  onAsset?: () => void;
}

// ---------- text measurement (resolution independent) ----------

export interface FontSpec {
  size: number; // mm
  family: string;
  bold?: boolean;
  italic?: boolean;
}
const REF = 10; // px per mm used for measurement
let measureCtx: CanvasRenderingContext2D | null = null;
export function fontString(f: FontSpec, k: number) {
  return `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${Math.max(0.1, f.size * k).toFixed(2)}px ${f.family || DEFAULT_FONT}`;
}
export function measureMm(text: string, f: FontSpec): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * f.size * 0.55;
  measureCtx.font = fontString(f, REF);
  return measureCtx.measureText(text).width / REF;
}

/** Greedy word wrap honouring explicit newlines; over-long words break by character. */
export function wrapText(text: string, f: FontSpec, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (!line || measureMm(candidate.trimEnd(), f) <= maxWidth) {
        line = candidate;
        continue;
      }
      out.push(line.trimEnd());
      line = word.trimStart();
      while (line && measureMm(line, f) > maxWidth && line.length > 1) {
        let n = line.length - 1;
        while (n > 1 && measureMm(line.slice(0, n), f) > maxWidth) n--;
        out.push(line.slice(0, n));
        line = line.slice(n);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

// ---------- images ----------

const images = new Map<string, HTMLImageElement>();
export function getImage(src: string, onLoad?: () => void): HTMLImageElement | null {
  if (!src) return null;
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.src = src;
    images.set(src, img);
  }
  if (img.complete && img.naturalWidth) return img;
  if (onLoad) img.addEventListener('load', onLoad, { once: true });
  return null;
}
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const ready = getImage(src);
    if (ready || !src) return resolve(ready);
    const img = images.get(src)!;
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener('error', () => resolve(null), { once: true });
  });
}

// ---------- entry ----------

/** Draw an element with the context origin at the element's top-left (device px). */
export function drawElement(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  ctx.save();
  try {
    switch (el.type) {
      case 'text': drawText(ctx, el, env); break;
      case 'legend': drawLegend(ctx, el, env); break;
      case 'scalebar': drawScaleBar(ctx, el, env); break;
      case 'northarrow': drawNorthArrow(ctx, el, env); break;
      case 'rect': drawRect(ctx, el, env); break;
      case 'image': drawImage(ctx, el, env); break;
      case 'chart': drawPlaceholder(ctx, el, env, 'Chart'); break;
      case 'map': break;
    }
  } finally {
    ctx.restore();
  }
}

function fillBg(ctx: CanvasRenderingContext2D, el: LayoutElement, k: number, color: string | undefined) {
  if (!color) return;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, el.w * k, el.h * k);
}
function strokeBorder(ctx: CanvasRenderingContext2D, el: LayoutElement, k: number, color: string | undefined, width: number | undefined) {
  if (!color || !(width && width > 0)) return;
  const lw = width * k;
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.strokeRect(lw / 2, lw / 2, el.w * k - lw, el.h * k - lw);
}
function clipBox(ctx: CanvasRenderingContext2D, el: LayoutElement, k: number) {
  ctx.beginPath();
  ctx.rect(0, 0, el.w * k, el.h * k);
  ctx.clip();
}

/** Map-frame decorations: background under the map, border over it. */
export function drawFrameBackground(ctx: CanvasRenderingContext2D, el: LayoutElement, k: number) {
  const p = el.props as MapFrameProps;
  fillBg(ctx, el, k, p.background);
}
export function drawFrameBorder(ctx: CanvasRenderingContext2D, el: LayoutElement, k: number) {
  const p = el.props as MapFrameProps;
  strokeBorder(ctx, el, k, p.borderColor, p.borderWidth);
}

// ---------- text ----------

export function textFont(p: TextProps): FontSpec {
  return { size: ptToMm(p.fontSize), family: p.fontFamily, bold: p.bold, italic: p.italic };
}

function drawText(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as TextProps;
  const { k } = env;
  fillBg(ctx, el, k, p.background);
  clipBox(ctx, el, k);
  const f = textFont(p);
  const pad = p.padding ?? 0;
  const innerW = Math.max(1, el.w - pad * 2);
  const lines = wrapText(resolveText(env.layout, el, p.text ?? ''), f, innerW);
  const lh = f.size * (p.lineHeight || 1.2);
  const total = lines.length * lh;
  const innerH = el.h - pad * 2;
  const y0 = pad + (p.vAlign === 'middle' ? (innerH - total) / 2 : p.vAlign === 'bottom' ? innerH - total : 0);
  ctx.font = fontString(f, k);
  ctx.fillStyle = p.color || '#000';
  ctx.textBaseline = 'middle';
  ctx.textAlign = p.align === 'center' ? 'center' : p.align === 'right' ? 'right' : 'left';
  const x = p.align === 'center' ? pad + innerW / 2 : p.align === 'right' ? pad + innerW : pad;
  lines.forEach((line, i) => ctx.fillText(line, x * k, (y0 + i * lh + lh / 2) * k));
}

// ---------- legend ----------

interface LegendRow {
  kind: 'title' | 'layer' | 'heading' | 'item' | 'gradient';
  text: string;
  symbol?: SymbolDef;
  geomType?: GeomType | null;
  gradient?: string[];
  height: number;
  /** Keep with next row when flowing columns. */
  keep?: boolean;
}
export interface LegendModel {
  title: LegendRow | null;
  rows: LegendRow[];
  font: FontSpec;
  swatchW: number;
  swatchH: number;
  gap: number;
}

/** Feature layers a legend can show (visible ones of the linked map), top-most first. */
export function legendLayers(layout: LayoutDoc, el: LayoutElement): FeatureLayer[] {
  const frame = resolveFrame(layout, el);
  const map = frame ? getMap((frame.props as MapFrameProps).mapId) : undefined;
  if (!map) return [];
  return map.layers.filter((l): l is FeatureLayer => l.kind === 'feature' && isLayerVisible(map, l));
}

export function legendModel(layout: LayoutDoc, el: LayoutElement): LegendModel {
  const p = el.props as LegendProps;
  const fs = ptToMm(p.fontSize || 8);
  const font: FontSpec = { size: fs, family: p.fontFamily };
  const swatchW = fs * 2;
  const swatchH = fs * 1.3;
  const gap = fs * 0.35;
  const rowH = Math.max(swatchH, fs * 1.2) + gap;
  const all = legendLayers(layout, el);
  const include = p.layerIds ? all.filter((l) => p.layerIds!.includes(l.id)) : all;
  const rows: LegendRow[] = [];
  for (const layer of include) {
    const ds = getDataset(layer.datasetId);
    const lg = legendFor(layer, ds);
    const single = layer.renderer.type === 'single';
    if (p.showLayerNames && !single) rows.push({ kind: 'layer', text: layer.name, height: fs * 1.35 + gap, keep: true });
    if (lg.heading && !single) rows.push({ kind: 'heading', text: lg.heading, height: fs * 1.25 + gap * 0.5, keep: true });
    if (lg.gradient) rows.push({ kind: 'gradient', text: lg.heading ?? layer.name, gradient: lg.gradient, height: rowH + fs });
    for (const item of lg.items) {
      const label = single ? (p.showLayerNames ? layer.name : item.label || layer.name) : item.label;
      rows.push({ kind: 'item', text: label, symbol: item.symbol, geomType: ds?.geomType ?? null, height: rowH });
    }
  }
  const title = p.title ? { kind: 'title' as const, text: p.title, height: fs * 1.3 * 1.45 + gap } : null;
  return { title, rows, font, swatchW, swatchH, gap };
}

/** Split rows into balanced columns, not separating a heading from its first item. */
export function flowColumns(rows: LegendRow[], columns: number): LegendRow[][] {
  const cols = Math.max(1, Math.round(columns));
  const total = rows.reduce((s, r) => s + r.height, 0);
  const target = total / cols;
  const out: LegendRow[][] = [[]];
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    let blockH = r.height;
    let j = i;
    while (rows[j]?.keep && j + 1 < rows.length) blockH += rows[++j].height;
    if (acc > 0 && !rows[i - 1]?.keep && acc + blockH / 2 > target && out.length < cols) {
      out.push([]);
      acc = 0;
    }
    out[out.length - 1].push(r);
    acc += r.height;
  }
  return out;
}

/** Height (mm) the legend needs at its current width/columns. */
export function legendContentHeight(layout: LayoutDoc, el: LayoutElement): number {
  const p = el.props as LegendProps;
  const m = legendModel(layout, el);
  const cols = flowColumns(m.rows, p.columns);
  const colH = Math.max(0, ...cols.map((c) => c.reduce((s, r) => s + r.height, 0)));
  return (p.padding ?? 0) * 2 + (m.title?.height ?? 0) + colH;
}

function drawLegend(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as LegendProps;
  const { k } = env;
  fillBg(ctx, el, k, p.background);
  ctx.save();
  clipBox(ctx, el, k);
  const m = legendModel(env.layout, el);
  const pad = p.padding ?? 0;
  const color = p.color || '#1b1b1b';
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let y = pad;
  if (m.title) {
    ctx.font = fontString({ ...m.font, size: m.font.size * 1.3, bold: true }, k);
    ctx.fillText(m.title.text, pad * k, (y + (m.title.height - m.gap) / 2) * k);
    y += m.title.height;
  }
  if (!m.rows.length) {
    ctx.font = fontString({ ...m.font, italic: true }, k);
    ctx.fillStyle = '#8a8a8a';
    ctx.fillText(resolveFrame(env.layout, el) ? 'No visible feature layers' : 'No map frame', pad * k, (y + m.font.size) * k);
  }
  const cols = flowColumns(m.rows, p.columns);
  const colGap = m.font.size * 1.5;
  const colW = (el.w - pad * 2 - colGap * (cols.length - 1)) / cols.length;
  cols.forEach((col, ci) => {
    const x0 = pad + ci * (colW + colGap);
    let cy = y;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * k, 0, colW * k, el.h * k);
    ctx.clip();
    for (const r of col) {
      const mid = cy + (r.height - m.gap) / 2;
      ctx.fillStyle = color;
      if (r.kind === 'layer') {
        ctx.font = fontString({ ...m.font, bold: true, size: m.font.size * 1.05 }, k);
        ctx.fillText(r.text, x0 * k, mid * k);
      } else if (r.kind === 'heading') {
        ctx.font = fontString({ ...m.font, italic: true }, k);
        ctx.fillText(r.text, x0 * k, mid * k);
      } else if (r.kind === 'item' && r.symbol) {
        drawSwatch(ctx, r.symbol, r.geomType ?? null, x0, mid - m.swatchH / 2, m.swatchW, m.swatchH, k);
        ctx.fillStyle = color;
        ctx.font = fontString(m.font, k);
        ctx.fillText(r.text, (x0 + m.swatchW + m.font.size * 0.6) * k, mid * k);
      } else if (r.kind === 'gradient' && r.gradient) {
        const gw = Math.min(colW, m.swatchW * 4);
        const g = ctx.createLinearGradient(x0 * k, 0, (x0 + gw) * k, 0);
        r.gradient.forEach((c, i) => g.addColorStop(i / Math.max(1, r.gradient!.length - 1), c));
        ctx.fillStyle = g;
        ctx.fillRect(x0 * k, cy * k, gw * k, m.swatchH * k);
        ctx.fillStyle = color;
        ctx.font = fontString({ ...m.font, size: m.font.size * 0.85 }, k);
        ctx.textBaseline = 'top';
        ctx.fillText('Low', x0 * k, (cy + m.swatchH + 0.4) * k);
        ctx.textAlign = 'right';
        ctx.fillText('High', (x0 + gw) * k, (cy + m.swatchH + 0.4) * k);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
      }
      cy += r.height;
    }
    ctx.restore();
  });
  ctx.restore();
  strokeBorder(ctx, el, k, p.borderColor, p.borderWidth);
}

const hexAlpha = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || 'transparent';
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Canvas twin of SymbolSwatch (symbology/legend.tsx), sized in mm; symbol px are 96-dpi px. */
export function drawSwatch(ctx: CanvasRenderingContext2D, s: SymbolDef, geomType: GeomType | null, x: number, y: number, w: number, h: number, k: number) {
  const px = (v: number) => (v / NOMINAL_PX_PER_MM) * k; // symbol px -> device px
  const sw = Math.min(px(s.strokeWidth), px(3));
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = hexAlpha(s.stroke, s.strokeOpacity ?? 1);
  ctx.setLineDash(s.strokeDash?.map((d) => px(d)) ?? []);
  const X = x * k, Y = y * k, W = w * k, H = h * k;
  if (geomType === 'Polygon') {
    ctx.fillStyle = hexAlpha(s.fill, s.fillOpacity);
    const inset = Math.max(sw / 2, k * 0.15);
    ctx.fillRect(X + inset, Y + inset, W - inset * 2, H - inset * 2);
    if (sw > 0) {
      ctx.lineWidth = sw;
      ctx.strokeRect(X + inset, Y + inset, W - inset * 2, H - inset * 2);
    }
  } else if (geomType === 'LineString') {
    ctx.lineWidth = Math.max(px(1), sw);
    ctx.beginPath();
    ctx.moveTo(X + k * 0.3, Y + H * 0.78);
    ctx.lineTo(X + W * 0.35, Y + H * 0.22);
    ctx.lineTo(X + W * 0.65, Y + H * 0.78);
    ctx.lineTo(X + W - k * 0.3, Y + H * 0.22);
    ctx.stroke();
  } else {
    const r = Math.max(k * 0.5, Math.min(px(s.size), H / 2 - k * 0.15));
    ctx.fillStyle = hexAlpha(s.fill, s.fillOpacity);
    ctx.lineWidth = Math.min(sw, px(1.5));
    markerPath(ctx, s.shape, X + W / 2, Y + H / 2, r);
    if (s.shape !== 'cross' && s.shape !== 'x') ctx.fill();
    if (ctx.lineWidth > 0 || s.shape === 'cross' || s.shape === 'x') {
      if (s.shape === 'cross' || s.shape === 'x') {
        ctx.strokeStyle = hexAlpha(s.fill, s.fillOpacity);
        ctx.lineWidth = Math.max(ctx.lineWidth, px(2));
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

function markerPath(ctx: CanvasRenderingContext2D, shape: SymbolDef['shape'], cx: number, cy: number, r: number) {
  ctx.beginPath();
  const poly = (pts: Array<[number, number]>) => {
    pts.forEach(([a, b], i) => (i ? ctx.lineTo(cx + a * r, cy + b * r) : ctx.moveTo(cx + a * r, cy + b * r)));
    ctx.closePath();
  };
  switch (shape) {
    case 'square': poly([[-0.85, -0.85], [0.85, -0.85], [0.85, 0.85], [-0.85, 0.85]]); break;
    case 'triangle': poly([[0, -1], [0.95, 0.75], [-0.95, 0.75]]); break;
    case 'diamond': poly([[0, -1], [1, 0], [0, 1], [-1, 0]]); break;
    case 'star': {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? 0.45 : 1;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      poly(pts);
      break;
    }
    case 'cross':
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
      break;
    case 'x': {
      const d = r * 0.75;
      ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d); ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
      break;
    }
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

// ---------- scale bar ----------

function drawScaleBar(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as ScaleBarProps;
  const { k } = env;
  fillBg(ctx, el, k, p.background);
  const frame = resolveFrame(env.layout, el);
  const scale = frameScale(frame);
  const f: FontSpec = { size: ptToMm(p.fontSize || 8), family: p.fontFamily };
  const color = p.color || '#1b1b1b';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.font = fontString(f, k);
  ctx.textBaseline = 'middle';
  if (!scale) {
    ctx.textAlign = 'center';
    ctx.font = fontString({ ...f, italic: true }, k);
    ctx.fillStyle = '#8a8a8a';
    ctx.fillText('No map frame', (el.w / 2) * k, (el.h / 2) * k);
    return;
  }
  if (p.style === 'text') {
    ctx.textAlign = 'center';
    ctx.fillText(formatScale(scale), (el.w / 2) * k, (el.h / 2) * k);
    return;
  }
  const pad = f.size * 0.3;
  const zeroHalf = measureMm('0', f) / 2;
  const unitW = measureMm(' ' + (p.units === 'imperial' ? 'mi' : 'km'), f) + pad;
  let maxW = el.w - zeroHalf - unitW - pad * 2;
  let lay = niceScaleBar(scale, maxW, p.units, p.divisions);
  if (lay) {
    const lastHalf = measureMm(formatDistance(lay.total), f) / 2;
    const unitW2 = measureMm(' ' + lay.unit, f);
    maxW = el.w - zeroHalf - Math.max(lastHalf, 0) - unitW2 - pad * 2;
    lay = niceScaleBar(scale, maxW, p.units, p.divisions) ?? lay;
  }
  if (!lay) return;
  const x0 = pad + zeroHalf;
  const labelH = f.size * 1.25;
  const barH = Math.max(0.6, Math.min(f.size * 0.75, el.h - labelH - pad * 2));
  const totalH = labelH + barH;
  const top = Math.max(0, (el.h - totalH) / 2);
  const barY = top + labelH;
  const lw = Math.max(0.12, f.size * 0.05) * k;
  ctx.lineWidth = lw;
  if (p.style === 'bar') {
    for (let i = 0; i < lay.segments; i++) {
      const sx = (x0 + i * lay.segmentMm) * k;
      ctx.fillStyle = i % 2 === 0 ? color : '#ffffff';
      ctx.fillRect(sx, barY * k, lay.segmentMm * k, barH * k);
    }
    ctx.strokeRect(x0 * k, barY * k, lay.segmentMm * lay.segments * k, barH * k);
  } else {
    const baseY = (barY + barH) * k;
    ctx.beginPath();
    ctx.moveTo(x0 * k, baseY);
    ctx.lineTo((x0 + lay.segmentMm * lay.segments) * k, baseY);
    for (let i = 0; i <= lay.segments; i++) {
      const sx = (x0 + i * lay.segmentMm) * k;
      const end = i === 0 || i === lay.segments;
      ctx.moveTo(sx, baseY);
      ctx.lineTo(sx, (barY + (end ? 0 : barH * 0.45)) * k);
    }
    ctx.lineCap = 'square';
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  const ly = (top + labelH * 0.45) * k;
  for (let i = 0; i <= lay.segments; i++) {
    const v = lay.segmentValue * i;
    ctx.fillText(formatDistance(v), (x0 + i * lay.segmentMm) * k, ly);
  }
  ctx.textAlign = 'left';
  const endX = x0 + lay.segmentMm * lay.segments + measureMm(formatDistance(lay.total), f) / 2;
  ctx.fillText(' ' + lay.unit, endX * k, ly);
}

// ---------- north arrow ----------

export const NORTH_ARROWS: Array<{ id: NorthArrowDesign; label: string }> = [
  { id: 'classic', label: 'Classic (split)' },
  { id: 'simple', label: 'Simple arrow' },
  { id: 'compass', label: 'Four-point compass' },
  { id: 'star', label: 'Eight-point rose' },
];

/** Rotation (radians, clockwise) of the linked frame's view. */
export function frameRotation(layout: LayoutDoc, el: LayoutElement): number {
  const frame = resolveFrame(layout, el);
  return frame ? (frame.props as MapFrameProps).view?.rotation ?? 0 : 0;
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as NorthArrowProps;
  const { k } = env;
  fillBg(ctx, el, k, p.background);
  const size = Math.min(el.w, el.h) * k;
  ctx.translate((el.w / 2) * k, (el.h / 2) * k);
  ctx.rotate(frameRotation(env.layout, el));
  const u = size / 100; // design units: a 100 x 100 box centred on 0,0
  const color = p.color || '#1b1b1b';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'miter';
  ctx.lineWidth = Math.max(0.8, 1.6 * u);
  const poly = (pts: Array<[number, number]>, fill: string | null, stroke = true) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * u, y * u) : ctx.moveTo(x * u, y * u)));
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) ctx.stroke();
  };
  const letter = (y: number, sizeU: number) => {
    ctx.fillStyle = color;
    ctx.font = `bold ${(sizeU * u).toFixed(2)}px ${DEFAULT_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, y * u);
  };
  switch (p.design) {
    case 'simple':
      poly([[0, -30], [20, 40], [0, 26], [-20, 40]], color);
      letter(-40, 20);
      break;
    case 'compass':
      poly([[0, -34], [8, -8], [0, 0]], color);
      poly([[0, -34], [-8, -8], [0, 0]], '#ffffff');
      poly([[0, 34], [8, 8], [0, 0]], '#ffffff');
      poly([[0, 34], [-8, 8], [0, 0]], color);
      poly([[34, 0], [8, 8], [0, 0]], color);
      poly([[34, 0], [8, -8], [0, 0]], '#ffffff');
      poly([[-34, 0], [-8, -8], [0, 0]], color);
      poly([[-34, 0], [-8, 8], [0, 0]], '#ffffff');
      letter(-43, 14);
      break;
    case 'star': {
      ctx.beginPath();
      ctx.arc(0, 4, 22 * u, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(0.6, 1 * u);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.6, 1.2 * u);
      ctx.save();
      ctx.translate(0, 4 * u);
      for (let i = 0; i < 8; i++) {
        const long = i % 2 === 0;
        const r = long ? 34 : 20;
        const wdt = long ? 7 : 5;
        ctx.save();
        ctx.rotate((i * Math.PI) / 4);
        poly([[0, -r], [wdt, -wdt * 0.6], [0, 0]], i % 2 === 0 ? color : '#ffffff');
        poly([[0, -r], [-wdt, -wdt * 0.6], [0, 0]], i % 2 === 0 ? '#ffffff' : color);
        ctx.restore();
      }
      ctx.restore();
      letter(-40, 14);
      break;
    }
    default: // classic
      poly([[0, -34], [0, 30], [-18, 42]], color);
      poly([[0, -34], [18, 42], [0, 30]], '#ffffff');
      letter(-44, 16);
  }
}

// ---------- rect, image, placeholder ----------

function drawRect(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as RectProps;
  const { k } = env;
  const lw = p.stroke && p.strokeWidth > 0 ? p.strokeWidth * k : 0;
  const r = Math.max(0, Math.min(p.radius || 0, el.w / 2, el.h / 2)) * k;
  ctx.beginPath();
  ctx.roundRect(lw / 2, lw / 2, el.w * k - lw, el.h * k - lw, r);
  if (p.fill) {
    ctx.fillStyle = p.fill;
    ctx.fill();
  }
  if (lw) {
    ctx.strokeStyle = p.stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

/** Box (mm, element-relative) an image occupies given its fit mode. */
export function imageBox(p: ImageProps, w: number, h: number): { x: number; y: number; w: number; h: number } {
  if (p.fit === 'stretch' || !p.naturalWidth || !p.naturalHeight) return { x: 0, y: 0, w, h };
  const s = Math.min(w / p.naturalWidth, h / p.naturalHeight);
  const iw = p.naturalWidth * s;
  const ih = p.naturalHeight * s;
  return { x: (w - iw) / 2, y: (h - ih) / 2, w: iw, h: ih };
}

function drawImage(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv) {
  const p = el.props as ImageProps;
  const { k } = env;
  const img = getImage(p.src, env.onAsset);
  if (!img) {
    if (!p.src) drawPlaceholder(ctx, el, env, 'No image');
    return;
  }
  const b = imageBox(p, el.w, el.h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, b.x * k, b.y * k, b.w * k, b.h * k);
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, el: LayoutElement, env: DrawEnv, label: string) {
  const { k } = env;
  ctx.fillStyle = '#f2f3f5';
  ctx.fillRect(0, 0, el.w * k, el.h * k);
  ctx.strokeStyle = '#b8bcc4';
  ctx.lineWidth = Math.max(1, 0.25 * k);
  ctx.setLineDash([k, k]);
  ctx.strokeRect(0.5, 0.5, el.w * k - 1, el.h * k - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = '#8a8f98';
  ctx.font = fontString({ size: Math.min(4, el.h / 4), family: DEFAULT_FONT }, k);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, (el.w / 2) * k, (el.h / 2) * k);
}
