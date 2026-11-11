// Element factories and the default composition used by layout.new.
import type { Id, LayoutDoc, LayoutElement, LayoutElementType, MapDoc, ViewState } from '../../core/types';
import { uid } from '../../core/data';
import { getMap } from '../../core/store';
import { getMapHandle } from '../../map/handle';
import { NOMINAL_PX_PER_MM } from './geometry';
import {
  DEFAULT_FONT, type ImageProps, type LegendProps, type MapFrameProps, type NorthArrowProps, type RectProps, type ScaleBarProps,
  type TextProps,
} from './types';

export const TYPE_LABELS: Record<LayoutElementType, string> = {
  map: 'Map Frame', text: 'Text', legend: 'Legend', scalebar: 'Scale Bar', northarrow: 'North Arrow', rect: 'Rectangle', image: 'Picture', chart: 'Chart',
};

export function textProps(patch: Partial<TextProps> = {}): TextProps {
  return {
    text: 'Text', fontSize: 12, fontFamily: DEFAULT_FONT, bold: false, italic: false, color: '#1b1b1b',
    align: 'left', vAlign: 'top', background: '', padding: 0, lineHeight: 1.2, ...patch,
  };
}

/**
 * Frame view so the map shows (roughly) what its open map window shows. The live window's
 * extent is fitted into the frame's 96-dpi pixel size; without an open view the map's stored view is used.
 */
export function frameViewFor(map: MapDoc, wMm: number, hMm: number): ViewState {
  const view = { ...map.view };
  const handle = getMapHandle(map.id);
  const size = handle?.map.getSize();
  if (handle && size && size[0] > 0 && size[1] > 0) {
    const v = handle.getViewState();
    const fw = wMm * NOMINAL_PX_PER_MM;
    const fh = hMm * NOMINAL_PX_PER_MM;
    return { ...v, zoom: v.zoom - Math.log2(Math.max(size[0] / fw, size[1] / fh)) };
  }
  return view;
}

export function makeElement(type: LayoutElementType, rect: { x: number; y: number; w: number; h: number }, props: Record<string, any>, name?: string): LayoutElement {
  return { id: uid('el'), type, name: name ?? TYPE_LABELS[type], ...rect, props };
}

export function makeMapFrame(map: MapDoc, rect: { x: number; y: number; w: number; h: number }): LayoutElement {
  const props: MapFrameProps = { mapId: map.id, view: frameViewFor(map, rect.w, rect.h), borderColor: '#1b1b1b', borderWidth: 0.35, background: '' };
  return makeElement('map', rect, props, map.name);
}

export const legendProps = (frameId: Id = '', patch: Partial<LegendProps> = {}): LegendProps => ({
  frameId, title: 'Legend', layerIds: null, columns: 1, fontSize: 8, fontFamily: DEFAULT_FONT, color: '#1b1b1b', showLayerNames: true,
  borderColor: '#9a9ea6', borderWidth: 0.2, background: '#ffffff', padding: 2.5, ...patch,
});
export const scaleBarProps = (frameId: Id = '', patch: Partial<ScaleBarProps> = {}): ScaleBarProps => ({
  frameId, style: 'bar', units: 'metric', divisions: 4, fontSize: 7, fontFamily: DEFAULT_FONT, color: '#1b1b1b', background: '', ...patch,
});
export const northArrowProps = (frameId: Id = '', patch: Partial<NorthArrowProps> = {}): NorthArrowProps => ({
  frameId, design: 'classic', color: '#1b1b1b', background: '', ...patch,
});
export const rectProps = (patch: Partial<RectProps> = {}): RectProps => ({ fill: '', stroke: '#1b1b1b', strokeWidth: 0.5, radius: 0, ...patch });
export const imageProps = (patch: Partial<ImageProps> = {}): ImageProps => ({ src: '', naturalWidth: 0, naturalHeight: 0, fit: 'contain', ...patch });

/** Default size of a newly inserted element (mm). */
export const DEFAULT_SIZE: Record<LayoutElementType, [number, number]> = {
  map: [120, 80], text: [60, 10], legend: [45, 40], scalebar: [60, 9], northarrow: [12, 16], rect: [50, 30], image: [40, 30], chart: [60, 40],
};

/** The standard first composition: title, map frame, legend, scale bar, north arrow, credits. */
export function defaultComposition(map: MapDoc | undefined, page: { width: number; height: number }, margin = 10): LayoutElement[] {
  const W = page.width;
  const H = page.height;
  const m = margin;
  const titleH = 12;
  const footH = 7;
  const frame = { x: m, y: m + titleH + 2, w: W - 2 * m, h: H - 2 * m - titleH - 2 - footH - 2 };
  const out: LayoutElement[] = [];
  const title = makeElement('text', { x: m, y: m, w: W - 2 * m, h: titleH }, textProps({ text: '{map}', fontSize: 22, bold: true, vAlign: 'middle' }), 'Title');
  const credits = makeElement(
    'text',
    { x: m, y: H - m - footH, w: W - 2 * m, h: footH },
    textProps({ text: '{project} · {crs} · {date}', fontSize: 7, color: '#555a61', vAlign: 'bottom' }),
    'Credits',
  );
  out.push(title, credits);
  if (map) {
    const mf = makeMapFrame(map, frame);
    const inset = 4;
    const lw = Math.min(55, frame.w * 0.3);
    const lh = Math.min(60, frame.h * 0.45);
    const legend = makeElement('legend', { x: frame.x + frame.w - lw - inset, y: frame.y + frame.h - lh - inset, w: lw, h: lh }, legendProps(mf.id));
    const sb = makeElement(
      'scalebar',
      { x: frame.x + inset, y: frame.y + frame.h - 10 - inset, w: Math.min(70, frame.w * 0.35), h: 10 },
      scaleBarProps(mf.id, { background: '#ffffff' }),
    );
    const na = makeElement('northarrow', { x: frame.x + frame.w - 14 - inset, y: frame.y + inset, w: 14, h: 18 }, northArrowProps(mf.id, { background: '' }));
    out.unshift(legend, sb, na);
    out.push(mf);
  }
  return out;
}

/** Name for a new map frame. */
export const frameName = (layout: LayoutDoc, mapId: Id) => {
  const base = getMap(mapId)?.name ?? 'Map Frame';
  const taken = new Set(layout.elements.map((e) => e.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
};
