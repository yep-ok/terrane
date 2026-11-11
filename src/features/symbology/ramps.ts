// Colour ramps — PUBLIC CONTRACT. Stops are #rrggbb, low to high.

export interface ColorRamp {
  name: string;
  kind: 'sequential' | 'diverging' | 'qualitative';
  /** Colour stops (#rrggbb), low to high. */
  colors: string[];
}

export const RAMPS: ColorRamp[] = [
  // sequential, multi-hue
  { name: 'Viridis', kind: 'sequential', colors: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'] },
  { name: 'Plasma', kind: 'sequential', colors: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'] },
  { name: 'Magma', kind: 'sequential', colors: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'] },
  { name: 'Inferno', kind: 'sequential', colors: ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'] },
  { name: 'Cividis', kind: 'sequential', colors: ['#00204d', '#414d6b', '#7c7b78', '#bcaf6f', '#ffea46'] },
  { name: 'Turbo', kind: 'sequential', colors: ['#30123b', '#4686fb', '#1ae4b6', '#a2fc3c', '#faba39', '#e4460a', '#7a0403'] },
  { name: 'Yellow-Green-Blue', kind: 'sequential', colors: ['#ffffd9', '#c7e9b4', '#41b6c4', '#225ea8', '#081d58'] },
  { name: 'Yellow-Orange-Red', kind: 'sequential', colors: ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'] },
  { name: 'Purple-Blue-Green', kind: 'sequential', colors: ['#fff7fb', '#d0d1e6', '#67a9cf', '#02818a', '#014636'] },
  { name: 'Orange-Red', kind: 'sequential', colors: ['#fff7ec', '#fdd49e', '#fc8d59', '#d7301f', '#7f0000'] },
  { name: 'Red-Purple', kind: 'sequential', colors: ['#fff7f3', '#fcc5c0', '#f768a1', '#ae017e', '#49006a'] },
  { name: 'Terrain', kind: 'sequential', colors: ['#2b6a9e', '#4aa36a', '#cfd873', '#b08a5a', '#f5f1ea'] },
  { name: 'Heat', kind: 'sequential', colors: ['#0000ff', '#00ffff', '#00ff00', '#ffff00', '#ff0000'] },
  // sequential, single hue
  { name: 'Blues', kind: 'sequential', colors: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'] },
  { name: 'Greens', kind: 'sequential', colors: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'] },
  { name: 'Oranges', kind: 'sequential', colors: ['#fff5eb', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'] },
  { name: 'Reds', kind: 'sequential', colors: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'] },
  { name: 'Purples', kind: 'sequential', colors: ['#fcfbfd', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'] },
  { name: 'Greys', kind: 'sequential', colors: ['#ffffff', '#d9d9d9', '#969696', '#525252', '#000000'] },
  // diverging
  { name: 'Red-Yellow-Blue', kind: 'diverging', colors: ['#d73027', '#fc8d59', '#fee090', '#ffffbf', '#e0f3f8', '#91bfdb', '#4575b4'] },
  { name: 'Red-Blue', kind: 'diverging', colors: ['#b2182b', '#ef8a62', '#fddbc7', '#f7f7f7', '#d1e5f0', '#67a9cf', '#2166ac'] },
  { name: 'Spectral', kind: 'diverging', colors: ['#d53e4f', '#fc8d59', '#fee08b', '#ffffbf', '#e6f598', '#99d594', '#3288bd'] },
  { name: 'Brown-Teal', kind: 'diverging', colors: ['#8c510a', '#d8b365', '#f6e8c3', '#f5f5f5', '#c7eae5', '#5ab4ac', '#01665e'] },
  { name: 'Purple-Green', kind: 'diverging', colors: ['#762a83', '#af8dc3', '#e7d4e8', '#f7f7f7', '#d9f0d3', '#7fbf7b', '#1b7837'] },
  { name: 'Pink-Green', kind: 'diverging', colors: ['#c51b7d', '#e9a3c9', '#fde0ef', '#f7f7f7', '#e6f5d0', '#a1d76a', '#4d9221'] },
  { name: 'Cool-Warm', kind: 'diverging', colors: ['#3b4cc0', '#8db0fe', '#dddddd', '#f4987a', '#b40426'] },
  // qualitative
  { name: 'Category10', kind: 'qualitative', colors: ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#bab0ac'] },
  { name: 'Set1', kind: 'qualitative', colors: ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3', '#ff7f00', '#ffd92f', '#a65628', '#f781bf', '#999999'] },
  { name: 'Set2', kind: 'qualitative', colors: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'] },
  { name: 'Dark2', kind: 'qualitative', colors: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'] },
  { name: 'Pastel', kind: 'qualitative', colors: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec', '#f2f2f2'] },
  { name: 'Paired', kind: 'qualitative', colors: ['#a6cee3', '#1f78b4', '#b2df8a', '#33a02c', '#fb9a99', '#e31a1c', '#fdbf6f', '#ff7f00', '#cab2d6', '#6a3d9a', '#ffff99', '#b15928'] },
  { name: 'Vivid', kind: 'qualitative', colors: ['#e58606', '#5d69b1', '#52bca3', '#99c945', '#cc61b0', '#24796c', '#daa51b', '#2f8ac4', '#764e9f', '#ed645a', '#a5aa99'] },
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

/** CSS linear-gradient for a ramp preview (qualitative ramps render as hard bands). */
export function rampGradientCss(name: string | undefined, reverse = false): string {
  const r = getRamp(name);
  const cols = reverse ? [...r.colors].reverse() : r.colors;
  if (r.kind === 'qualitative') {
    const step = 100 / cols.length;
    return `linear-gradient(to right, ${cols.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
  }
  return `linear-gradient(to right, ${cols.join(', ')})`;
}
