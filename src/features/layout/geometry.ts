// Pure layout maths: unit conversions, snapping, alignment, scale-bar divisions, tokens.
// No DOM, OL or React here so everything is unit-testable in node.

export const MM_PER_INCH = 25.4;
export const MM_PER_PT = MM_PER_INCH / 72;
/** CSS pixels per millimetre at 96 dpi: the nominal resolution map frames are rendered at. */
export const NOMINAL_PX_PER_MM = 96 / MM_PER_INCH;

export const mmToPx = (mm: number, pxPerMm: number) => mm * pxPerMm;
export const pxToMm = (px: number, pxPerMm: number) => px / pxPerMm;
export const ptToMm = (pt: number) => pt * MM_PER_PT;
export const mmToPt = (mm: number) => mm / MM_PER_PT;
export const dpiToPxPerMm = (dpi: number) => dpi / MM_PER_INCH;
/** Pixel size of a page/element dimension at a print resolution. */
export const mmToDevicePx = (mm: number, dpi: number) => Math.max(1, Math.round((mm / MM_PER_INCH) * dpi));

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zoom (screen px per mm) that fits a page into a viewport with padding (px). */
export function fitZoom(page: { width: number; height: number }, viewport: { width: number; height: number }, padding = 24): number {
  const zw = (viewport.width - padding * 2) / page.width;
  const zh = (viewport.height - padding * 2) / page.height;
  return clamp(Math.min(zw, zh), 0.05, 40);
}

// ---------- snapping ----------

export interface SnapTargets {
  /** Vertical guide lines (x positions, mm). */
  xs: number[];
  /** Horizontal guide lines (y positions, mm). */
  ys: number[];
}
export interface SnapResult {
  dx: number;
  dy: number;
  /** Guides that matched (drawn as lines). */
  guideX: number | null;
  guideY: number | null;
}

/** Candidate lines: page edges + centre, margin lines, and other rects' edges + centres. */
export function snapTargets(page: { width: number; height: number }, others: Rect[], margin?: number): SnapTargets {
  const xs = [0, page.width / 2, page.width];
  const ys = [0, page.height / 2, page.height];
  if (margin && margin > 0) {
    xs.push(margin, page.width - margin);
    ys.push(margin, page.height - margin);
  }
  for (const r of others) {
    xs.push(r.x, r.x + r.w / 2, r.x + r.w);
    ys.push(r.y, r.y + r.h / 2, r.y + r.h);
  }
  return { xs, ys };
}

function bestSnap(values: number[], targets: number[], threshold: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values)
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
  return best;
}

/** Snap a moving rectangle (its left/centre/right and top/middle/bottom) to target lines. */
export function snapMove(r: Rect, targets: SnapTargets, threshold: number): SnapResult {
  const sx = bestSnap([r.x, r.x + r.w / 2, r.x + r.w], targets.xs, threshold);
  const sy = bestSnap([r.y, r.y + r.h / 2, r.y + r.h], targets.ys, threshold);
  return { dx: sx?.delta ?? 0, dy: sy?.delta ?? 0, guideX: sx?.at ?? null, guideY: sy?.at ?? null };
}

/** Snap one moving edge value (resize). */
export function snapValue(v: number, targets: number[], threshold: number): { value: number; guide: number | null } {
  const s = bestSnap([v], targets, threshold);
  return s ? { value: v + s.delta, guide: s.at } : { value: v, guide: null };
}

export const snapToGrid = (v: number, grid: number) => (grid > 0 ? Math.round(v / grid) * grid : v);

// ---------- resize ----------

/** Handle ids: n, s, e, w and corners. */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * New rectangle after dragging `handle` by (dx, dy) mm. keepAspect keeps the start aspect
 * ratio (corner handles scale both axes; edge handles scale the other axis around the centre).
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, keepAspect: boolean, min = 1): Rect {
  let { x, y, w, h } = start;
  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');
  if (east) w = start.w + dx;
  if (west) w = start.w - dx;
  if (south) h = start.h + dy;
  if (north) h = start.h - dy;
  w = Math.max(min, w);
  h = Math.max(min, h);
  if (keepAspect && start.w > 0 && start.h > 0) {
    const aspect = start.w / start.h;
    const corner = (east || west) && (north || south);
    if (corner) {
      if (w / start.w > h / start.h) h = w / aspect;
      else w = h * aspect;
    } else if (east || west) h = w / aspect;
    else w = h * aspect;
    if (!(east || west)) x = start.x + (start.w - w) / 2;
    if (!(north || south)) y = start.y + (start.h - h) / 2;
  }
  if (west) x = start.x + start.w - w;
  if (north) y = start.y + start.h - h;
  return { x, y, w, h };
}

// ---------- align / distribute ----------

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function boundsOf(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Align rects to their common bounds (or to `to`, e.g. the page, when a single rect is aligned). */
export function alignRects(rects: Rect[], mode: AlignMode, to?: Rect): Array<{ x: number; y: number }> {
  const b = to ?? boundsOf(rects);
  return rects.map((r) => {
    switch (mode) {
      case 'left': return { x: b.x, y: r.y };
      case 'hcenter': return { x: b.x + (b.w - r.w) / 2, y: r.y };
      case 'right': return { x: b.x + b.w - r.w, y: r.y };
      case 'top': return { x: r.x, y: b.y };
      case 'vcenter': return { x: r.x, y: b.y + (b.h - r.h) / 2 };
      case 'bottom': return { x: r.x, y: b.y + b.h - r.h };
    }
  });
}

/** Distribute rects so the gaps between them are equal (outermost stay put). Returns positions in input order. */
export function distributeRects(rects: Rect[], axis: 'h' | 'v'): Array<{ x: number; y: number }> {
  const out = rects.map((r) => ({ x: r.x, y: r.y }));
  if (rects.length < 3) return out;
  const order = rects.map((r, i) => ({ r, i })).sort((a, b) => (axis === 'h' ? a.r.x - b.r.x : a.r.y - b.r.y));
  const first = order[0].r;
  const last = order[order.length - 1].r;
  const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y;
  const total = order.reduce((s, o) => s + (axis === 'h' ? o.r.w : o.r.h), 0);
  const gap = (span - total) / (order.length - 1);
  let pos = axis === 'h' ? first.x : first.y;
  for (const o of order) {
    if (axis === 'h') out[o.i].x = pos;
    else out[o.i].y = pos;
    pos += (axis === 'h' ? o.r.w : o.r.h) + gap;
  }
  return out;
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Normalised rectangle from two corner points. */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

// ---------- scale bar ----------

const NICE = [1, 2, 2.5, 5];

/** Largest "nice" number (1, 2, 2.5, 5 × 10^n) not above v. */
export function niceFloor(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return 0;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  let best = base;
  for (const n of NICE) if (n * base <= v * (1 + 1e-9)) best = n * base;
  return best;
}

export interface ScaleBarLayout {
  /** Unit label, e.g. 'km', 'm', 'mi', 'ft'. */
  unit: string;
  /** Number of segments. */
  segments: number;
  /** Ground value of one segment in `unit`. */
  segmentValue: number;
  /** Paper length of one segment (mm). */
  segmentMm: number;
  /** Total ground value in `unit`. */
  total: number;
}

const M_PER_FT = 0.3048;
const FT_PER_MI = 5280;

/**
 * Nice scale-bar divisions for a map scale (1:scale) that fit in maxWidthMm.
 * Metric switches from m to km once the total reaches 1 km; imperial from ft to mi at 1 mile.
 */
export function niceScaleBar(scale: number, maxWidthMm: number, units: 'metric' | 'imperial', segments = 4): ScaleBarLayout | null {
  if (!(scale > 0) || !(maxWidthMm > 0)) return null;
  const n = Math.max(1, Math.round(segments));
  const groundM = (maxWidthMm / 1000) * scale; // metres representable by the full width
  const pick = (groundInUnit: number, metresPerUnit: number, unit: string): ScaleBarLayout | null => {
    const seg = niceFloor(groundInUnit / n);
    if (!seg) return null;
    return { unit, segments: n, segmentValue: seg, segmentMm: ((seg * metresPerUnit) / scale) * 1000, total: seg * n };
  };
  if (units === 'metric') {
    const m = pick(groundM, 1, 'm');
    if (m && m.total >= 1000) return pick(groundM / 1000, 1000, 'km');
    return m;
  }
  const ft = pick(groundM / M_PER_FT, M_PER_FT, 'ft');
  if (ft && ft.total >= FT_PER_MI) return pick(groundM / (M_PER_FT * FT_PER_MI), M_PER_FT * FT_PER_MI, 'mi');
  return ft;
}

/** Number label without float noise: 2.5, 1000, 0.25. */
export function formatDistance(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return r.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** "1:50,000" (rounded to 3 significant figures above 1:1000). */
export function formatScale(scale: number): string {
  if (!(scale > 0) || !Number.isFinite(scale)) return '1:—';
  let s = Math.round(scale);
  if (s >= 1000) {
    const mag = 10 ** (Math.floor(Math.log10(s)) - 2);
    s = Math.round(s / mag) * mag;
  }
  return '1:' + s.toLocaleString('en-US');
}

/** Parse "1:25,000", "25000", "1 : 25 000". */
export function parseScale(text: string): number | null {
  const n = Number(text.trim().replace(/^1\s*:\s*/, '').replace(/[,\s_]/g, ''));
  return n > 0 && Number.isFinite(n) ? n : null;
}

// ---------- tokens ----------

/** Replace {token} placeholders (case-insensitive); unknown tokens are left untouched. */
export function substituteTokens(text: string, values: Record<string, string>): string {
  const lower: Record<string, string> = {};
  for (const k in values) lower[k.toLowerCase()] = values[k];
  return text.replace(/\{([a-zA-Z_]+)\}/g, (m, key: string) => (key.toLowerCase() in lower ? lower[key.toLowerCase()] : m));
}

export const TOKENS: Array<{ token: string; description: string }> = [
  { token: '{project}', description: 'Project name' },
  { token: '{layout}', description: 'Layout name' },
  { token: '{map}', description: 'Name of the linked map' },
  { token: '{date}', description: "Today's date" },
  { token: '{time}', description: 'Current time' },
  { token: '{scale}', description: 'Scale of the linked map frame' },
  { token: '{crs}', description: 'Coordinate system of the linked map' },
  { token: '{author}', description: 'Author from page setup' },
];

// ---------- PNG resolution metadata ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Insert (or replace) a pHYs chunk so the PNG carries its print resolution. */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || sig.some((b, i) => png[i] !== b)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 8 + view.getUint32(8) + 4;
  // drop any existing pHYs chunk
  const parts: Uint8Array[] = [png.subarray(0, ihdrEnd)];
  let off = ihdrEnd;
  const rest: Uint8Array[] = [];
  while (off + 8 <= png.length) {
    const len = view.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    const end = off + 12 + len;
    if (type !== 'pHYs') rest.push(png.subarray(off, end));
    off = end;
  }
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4); // 'pHYs'
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  parts.push(chunk, ...rest);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
