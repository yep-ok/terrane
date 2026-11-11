// Page renderer for export/print. Draws the page to a canvas without screenshotting the DOM:
// map frames get an offscreen MapRuntime at the target pixel size, everything else is drawn
// with the same canvas code as the screen (draw.ts).
import type { Id, LayoutDoc, LayoutElement } from '../../core/types';
import { getLayout } from '../../core/store';
import { notify, setBusy } from '../../core/ui';
import { downloadBlob } from '../../ui/kit';
import { MapRuntime, composeMapCanvas } from '../../map/runtime';
import { mmToDevicePx, NOMINAL_PX_PER_MM, pngWithDpi } from './geometry';
import { drawElement, drawFrameBackground, drawFrameBorder, loadImage } from './draw';
import type { ImageProps, MapFrameProps } from './types';

export type ExportFormat = 'pdf' | 'png';
export interface ExportOptions {
  format: ExportFormat;
  dpi: number;
  fileName: string;
}

const MAX_SIDE = 32000;
const MAX_AREA = 200_000_000;
const RENDER_TIMEOUT = 45_000;

export function exportPixelSize(layout: LayoutDoc, dpi: number) {
  return { width: mmToDevicePx(layout.page.width, dpi), height: mmToDevicePx(layout.page.height, dpi) };
}

/** Render one map frame offscreen at `dpi`; resolves with a canvas of the frame's pixel size. */
async function renderMapFrame(el: LayoutElement, dpi: number): Promise<HTMLCanvasElement | null> {
  const p = el.props as MapFrameProps;
  const host = document.createElement('div');
  const w = el.w * NOMINAL_PX_PER_MM;
  const h = el.h * NOMINAL_PX_PER_MM;
  Object.assign(host.style, {
    position: 'fixed', left: '-100000px', top: '0px', width: `${w}px`, height: `${h}px`, pointerEvents: 'none', contain: 'strict',
  });
  document.body.appendChild(host);
  let rt: MapRuntime | null = null;
  try {
    rt = new MapRuntime({ mapId: p.mapId, target: host, interactive: false, view: p.view, pixelRatio: dpi / 96 });
    const map = rt.map;
    map.updateSize();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        notify(`"${el.name}": some map content did not finish loading in time; exporting what was drawn.`, 'warning');
        resolve();
      }, RENDER_TIMEOUT);
      map.once('rendercomplete', () => {
        clearTimeout(timer);
        resolve();
      });
      map.renderSync();
    });
    return composeMapCanvas(map);
  } catch (err) {
    console.error('map frame render failed', err);
    return null;
  } finally {
    rt?.destroy();
    host.remove();
  }
}

/** Draw the whole page at `dpi`. elements[0] is on top, so draw from the end. */
export async function renderLayout(layout: LayoutDoc, dpi: number, progress?: (label: string) => void): Promise<HTMLCanvasElement> {
  const { width, height } = exportPixelSize(layout, dpi);
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA)
    throw new Error(`A ${width} × ${height} px page is too large for the browser; choose a lower resolution.`);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing surface for the export.');
  const kx = width / layout.page.width;
  const ky = height / layout.page.height;
  const k = (kx + ky) / 2;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const visible = layout.elements.filter((e) => !e.props.hidden);
  await Promise.all(visible.filter((e) => e.type === 'image').map((e) => loadImage((e.props as ImageProps).src)));
  const frames = visible.filter((e) => e.type === 'map');
  let frameNo = 0;
  for (let i = visible.length - 1; i >= 0; i--) {
    const el = visible[i];
    ctx.save();
    ctx.translate(el.x * kx, el.y * ky);
    if (el.type === 'map') {
      frameNo++;
      progress?.(frames.length > 1 ? `Rendering map frame ${frameNo} of ${frames.length}…` : 'Rendering map frame…');
      ctx.beginPath();
      ctx.rect(0, 0, el.w * k, el.h * k);
      ctx.clip();
      drawFrameBackground(ctx, el, k);
      const img = await renderMapFrame(el, dpi);
      if (img) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, el.w * k, el.h * k);
      }
      drawFrameBorder(ctx, el, k);
    } else {
      drawElement(ctx, el, { layout, k });
    }
    ctx.restore();
  }
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding the image failed.'))), type, quality));

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'layout';

export async function exportLayout(layoutId: Id, opts: ExportOptions) {
  const layout = getLayout(layoutId);
  if (!layout) return notify('The layout no longer exists.', 'error');
  const base = safeFileName(opts.fileName.replace(/\.(pdf|png)$/i, ''));
  setBusy('Exporting layout…');
  try {
    const canvas = await renderLayout(layout, opts.dpi, (s) => setBusy(s));
    setBusy(opts.format === 'pdf' ? 'Writing PDF…' : 'Writing PNG…');
    if (opts.format === 'png') {
      const blob = await toBlob(canvas, 'image/png');
      const bytes = pngWithDpi(new Uint8Array(await blob.arrayBuffer()), opts.dpi);
      downloadBlob(new Blob([bytes as BlobPart], { type: 'image/png' }), base + '.png');
    } else {
      const { jsPDF } = await import('jspdf');
      const { width: W, height: H } = layout.page;
      const pdf = new jsPDF({ orientation: W > H ? 'landscape' : 'portrait', unit: 'mm', format: [W, H], compress: true });
      pdf.setProperties({ title: layout.name, creator: 'Terrane' });
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, W, H, undefined, 'FAST');
      downloadBlob(pdf.output('blob'), base + '.pdf');
    }
    notify(`Exported ${base}.${opts.format} (${canvas.width} × ${canvas.height} px, ${opts.dpi} dpi).`, 'success');
  } catch (err: any) {
    console.error(err);
    notify(`Export failed: ${err?.message ?? err}`, 'error');
  } finally {
    setBusy(null);
  }
}

/** Render the page and hand it to the browser's print dialog via a hidden frame. */
export async function printLayout(layoutId: Id, dpi = 200) {
  const layout = getLayout(layoutId);
  if (!layout) return;
  setBusy('Preparing print…');
  try {
    const canvas = await renderLayout(layout, dpi, (s) => setBusy(s));
    const url = URL.createObjectURL(await toBlob(canvas, 'image/png'));
    const { width: W, height: H } = layout.page;
    const frame = document.createElement('iframe');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
    document.body.appendChild(frame);
    const cleanup = () => {
      frame.remove();
      URL.revokeObjectURL(url);
    };
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(
      `<!doctype html><html><head><title>${layout.name.replace(/[<&]/g, '')}</title><style>` +
        `@page{size:${W}mm ${H}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${W}mm;height:${H}mm}` +
        `</style></head><body><img alt=""></body></html>`,
    );
    doc.close();
    const img = doc.querySelector('img')!;
    img.onload = () => {
      const win = frame.contentWindow!;
      win.addEventListener('afterprint', () => setTimeout(cleanup, 100), { once: true });
      setTimeout(cleanup, 120_000);
      win.focus();
      win.print();
    };
    img.onerror = () => {
      cleanup();
      notify('Print preparation failed.', 'error');
    };
    img.src = url;
  } catch (err: any) {
    notify(`Print failed: ${err?.message ?? err}`, 'error');
  } finally {
    setBusy(null);
  }
}

export const DPI_OPTIONS = [96, 150, 300];
