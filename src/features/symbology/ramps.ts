// Colour ramps — PUBLIC CONTRACT (placeholder set; the symbology module extends this).

export interface ColorRamp {
  name: string;
  kind: 'sequential' | 'diverging' | 'qualitative';
  /** Colour stops (#rrggbb), low to high. */
  colors: string[];
}

export const RAMPS: ColorRamp[] = [
  { name: 'Viridis', kind: 'sequential', colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  { name: 'Blues', kind: 'sequential', colors: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
  { name: 'Heat', kind: 'sequential', colors: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'] },
  { name: 'Category10', kind: 'qualitative', colors: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ac'] },
];

export function getRamp(name: string | undefined): ColorRamp {
  return RAMPS.find((r) => r.name === name) ?? RAMPS[0];
}

function lerpHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) + (((pb >> shift) & 255) - ((pa >> shift) & 255)) * t);
  return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
}

/** Colour at position t (0..1) along a ramp (interpolated; qualitative ramps snap). */
export function rampColorAt(name: string | undefined, t: number): string {
  const r = getRamp(name);
  const n = r.colors.length;
  const x = Math.max(0, Math.min(1, t));
  if (r.kind === 'qualitative') return r.colors[Math.min(n - 1, Math.floor(x * n))];
  const pos = x * (n - 1);
  const i = Math.min(n - 2, Math.floor(pos));
  return lerpHex(r.colors[i], r.colors[i + 1], pos - i);
}

/** n colours sampled along a ramp (qualitative ramps cycle). */
export function rampColors(name: string | undefined, n: number): string[] {
  const r = getRamp(name);
  if (r.kind === 'qualitative') return Array.from({ length: n }, (_, i) => r.colors[i % r.colors.length]);
  if (n <= 1) return [rampColorAt(name, 0.5)];
  return Array.from({ length: n }, (_, i) => rampColorAt(name, i / (n - 1)));
}
