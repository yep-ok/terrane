// Export helpers: standalone SVG (computed colours inlined), PNG via canvas, CSV to clipboard.
const INLINE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'paint-order',
];

export const safeFileName = (name: string) => (name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'chart').slice(0, 80);

function backgroundOf(el: Element | null): string {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) return c;
  }
  return '#ffffff';
}

/** Clone the live chart SVG with every computed paint/font property written inline so it renders anywhere. */
export function serializeSvg(svg: SVGSVGElement): { xml: string; width: number; height: number } {
  const width = Number(svg.getAttribute('width')) || svg.clientWidth;
  const height = Number(svg.getAttribute('height')) || svg.clientHeight;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const bg = backgroundOf(svg.parentElement);
  const drop: Element[] = [];
  src.forEach((s, i) => {
    const d = dst[i] as SVGElement;
    if (!d || !('style' in d)) return;
    const cs = getComputedStyle(s);
    for (const p of INLINE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) d.style.setProperty(p, v);
    }
    if (s.classList.contains('tc-surface') || s.classList.contains('tc-brush') || s.classList.contains('tc-guide')) drop.push(d);
    d.removeAttribute('class');
    d.removeAttribute('pointer-events');
  });
  const bgRect = clone.querySelector('rect');
  if (bgRect) bgRect.style.setProperty('fill', bg);
  drop.forEach((d) => d.remove());
  clone.querySelectorAll('title').forEach((t) => t.remove());
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return { xml: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`, width, height };
}

export function svgBlob(svg: SVGSVGElement): Blob {
  return new Blob([serializeSvg(svg).xml], { type: 'image/svg+xml;charset=utf-8' });
}

/** Rasterise the chart at `scale`x (default 2x) to a PNG blob. */
export async function pngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  const { xml, width, height } = serializeSvg(svg);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the chart image'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
