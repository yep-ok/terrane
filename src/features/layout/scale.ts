// Map-frame scale maths that needs OpenLayers projections (but no live map), plus the
// dynamic-token environment shared by the screen renderer and the exporter.
import View from 'ol/View';
import { fromLonLat, getPointResolution, get as getProjection } from 'ol/proj';
import type { Id, LayoutDoc, LayoutElement, MapDoc, ViewState } from '../../core/types';
import { getMap, getProject } from '../../core/store';
import { crsName, ensureCrsSync } from '../../core/crs';
import { formatScale, substituteTokens } from './geometry';
import { metaOf, type MapFrameProps } from './types';

const INCHES_PER_METRE = 39.37007874;

/** Display CRS a runtime would use for this map (falls back like MapRuntime does). */
export function frameCrs(map: MapDoc | undefined): string {
  return map && ensureCrsSync(map.crs) ? map.crs : 'EPSG:3857';
}

/** Scale denominator of a view rendered at 96 dpi (what MapRuntime.getScale() reports). */
export function scaleOfView(view: ViewState, crs: string): number {
  const proj = getProjection(crs);
  if (!proj) return 0;
  try {
    const center = fromLonLat(view.center, proj);
    const v = new View({ projection: proj, center, zoom: view.zoom, constrainResolution: false, maxZoom: 24, minZoom: 0 }); // same as MapRuntime
    const res = v.getResolution();
    if (!res) return 0;
    return getPointResolution(proj, res, center, 'm') * INCHES_PER_METRE * 96;
  } catch {
    return 0;
  }
}

/** Zoom level giving an exact scale denominator for a view (resolution is proportional to 2^-zoom). */
export function zoomForScale(view: ViewState, crs: string, scale: number): number | null {
  const cur = scaleOfView(view, crs);
  if (!cur || !(scale > 0)) return null;
  return view.zoom + Math.log2(cur / scale);
}

export function frameScale(frame: LayoutElement | undefined): number {
  if (!frame || frame.type !== 'map') return 0;
  const p = frame.props as MapFrameProps;
  return scaleOfView(p.view, frameCrs(getMap(p.mapId)));
}

/** The map frame an element is linked to: its frameId, else the first (top-most) map frame. */
export function resolveFrame(layout: LayoutDoc, el?: LayoutElement | null): LayoutElement | undefined {
  const id: Id | undefined = el?.props?.frameId;
  return (id && layout.elements.find((e) => e.id === id && e.type === 'map')) || layout.elements.find((e) => e.type === 'map');
}

export function tokenValues(layout: LayoutDoc, el?: LayoutElement | null): Record<string, string> {
  const frame = resolveFrame(layout, el);
  const map = frame ? getMap((frame.props as MapFrameProps).mapId) : undefined;
  const now = new Date();
  return {
    project: getProject().name,
    layout: layout.name,
    map: map?.name ?? '',
    date: now.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    time: now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
    scale: frame ? formatScale(frameScale(frame)) : '',
    crs: map ? crsName(frameCrs(map)) : '',
    author: metaOf(layout).author ?? '',
  };
}

export const resolveText = (layout: LayoutDoc, el: LayoutElement, text: string) => substituteTokens(text, tokenValues(layout, el));
