// Selection tools (rectangle, polygon, lasso) and selection commands.
import { always, never } from 'ol/events/condition';
import Draw from 'ol/interaction/Draw';
import DragBox from 'ol/interaction/DragBox';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type Polygon from 'ol/geom/Polygon';
import type { Coordinate } from 'ol/coordinate';
import { Circle, Fill, Stroke, Style } from 'ol/style';
import type { Geometry as GJ } from 'geojson';
import { BoxSelect, Eraser, Focus, ListChecks, Lasso, Pentagon, FlipHorizontal2 } from 'lucide-react';
import type { FeatureLayer, Id } from '../../core/types';
import { getMap, isLayerVisible } from '../../core/store';
import { clearSelection, getSelection, notify, setSelection, totalSelected, type SelectMode } from '../../core/ui';
import { registerCommand, registerMapTool } from '../../core/registry';
import type { MapHandle } from '../../map/handle';
import { intersects } from './spatial';
import { layerFeatures, needHandle, resolveFeatureLayer } from './util';

export type Mods = { shift: boolean; ctrl: boolean };
export const modeOf = (m: Mods): SelectMode => (m.shift ? 'add' : m.ctrl ? 'remove' : 'new');

/** Visible, selectable feature layers of a map at the current zoom. */
export function selectableLayers(handle: MapHandle): FeatureLayer[] {
  const map = getMap(handle.mapId);
  if (!map) return [];
  const zoom = handle.map.getView().getZoom() ?? 0;
  const out: FeatureLayer[] = [];
  for (const l of map.layers) {
    if (l.kind !== 'feature' || !l.selectable || !isLayerVisible(map, l)) continue;
    if (l.minZoom !== undefined && zoom <= l.minZoom) continue;
    if (l.maxZoom !== undefined && zoom > l.maxZoom) continue;
    out.push(l);
  }
  return out;
}

/** Apply per-layer id lists to the selection. 'new' replaces the selection of every layer. */
function applyResults(results: Map<Id, number[]>, mode: SelectMode) {
  if (mode === 'new') clearSelection();
  for (const [layerId, ids] of results) if (ids.length) setSelection(layerId, ids, mode === 'new' ? 'new' : mode);
}

/** Densify a map-CRS ring so straight edges stay straight after conversion to lon/lat. */
function ringToLonLat(handle: MapHandle, ring: Coordinate[]): number[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const out: Coordinate[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const k = Math.min(24, Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (span / 24))));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  const ll = out.map((c) => handle.toLonLat(c) as number[]);
  ll.push(ll[0]);
  return ll;
}

/** Select features of all selectable layers that intersect a polygon drawn in map coordinates. */
export function selectByMapPolygon(handle: MapHandle, poly: Polygon, mods: Mods): number {
  const ring = poly.getCoordinates()[0];
  if (!ring || ring.length < 4) return 0;
  const shape: GJ = { type: 'Polygon', coordinates: [ringToLonLat(handle, ring)] };
  const extent = poly.getExtent();
  const results = new Map<Id, number[]>();
  let count = 0;
  for (const layer of selectableLayers(handle)) {
    const src = handle.source(layer.id);
    if (!src) continue;
    const ids: number[] = [];
    for (const f of src.getFeaturesInExtent(extent)) {
      const feat = f.get('feat');
      if (feat?.geometry && intersects(shape, feat.geometry)) ids.push(feat.id);
    }
    results.set(layer.id, ids);
    count += ids.length;
  }
  applyResults(results, modeOf(mods));
  return count;
}

/** Select the top-most feature at a pixel. */
export function selectAtPixel(handle: MapHandle, pixel: number[], mods: Mods): boolean {
  const hit = handle.hitTest(pixel, { tolerance: 5 })[0];
  if (!hit) {
    if (modeOf(mods) === 'new') clearSelection();
    return false;
  }
  applyResults(new Map([[hit.layerId, [hit.fid]]]), modeOf(mods));
  return true;
}

const sketchStyle = new Style({
  stroke: new Stroke({ color: '#00e5ff', width: 2, lineDash: [6, 4] }),
  fill: new Fill({ color: 'rgba(0,229,255,0.12)' }),
  image: new Circle({ radius: 4, fill: new Fill({ color: '#00e5ff' }), stroke: new Stroke({ color: '#fff', width: 1 }) }),
});

/** Track the modifier keys at the most recent pointer press / key event on the viewport. */
function trackMods(handle: MapHandle) {
  const mods: Mods = { shift: false, ctrl: false };
  const upd = (e: MouseEvent | KeyboardEvent) => {
    mods.shift = e.shiftKey;
    mods.ctrl = e.ctrlKey || e.metaKey;
  };
  const vp = handle.map.getViewport()!;
  vp.addEventListener('pointerdown', upd, true);
  vp.addEventListener('pointermove', upd, true);
  return { mods, dispose: () => { vp.removeEventListener('pointerdown', upd, true); vp.removeEventListener('pointermove', upd, true); } };
}

function drawTool(kind: 'polygon' | 'lasso') {
  return (handle: MapHandle) => {
    handle.setDragPan(false);
    const tracker = trackMods(handle);
    const draw = new Draw({
      type: 'Polygon',
      style: sketchStyle,
      condition: (e) => (e.originalEvent as MouseEvent).button === 0,
      freehand: kind === 'lasso',
      freehandCondition: kind === 'lasso' ? always : never,
    });
    draw.on('drawend', (e) => {
      const geom = e.feature.getGeometry() as Polygon | undefined;
      if (!geom) return;
      selectByMapPolygon(handle, geom, tracker.mods);
    });
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && draw.finishDrawing();
    document.addEventListener('keydown', onKey);
    handle.map.addInteraction(draw);
    return () => {
      document.removeEventListener('keydown', onKey);
      tracker.dispose();
      handle.map.removeInteraction(draw);
      handle.setDragPan(true);
    };
  };
}

export function registerSelectionTools() {
  registerMapTool({
    id: 'select-rect',
    title: 'Select By Rectangle',
    icon: BoxSelect,
    cursor: 'crosshair',
    activate(handle) {
      handle.setDragPan(false);
      const box = new DragBox({ className: 'nav-dragbox', condition: (e) => (e.originalEvent as MouseEvent).button === 0 });
      box.on('boxend', (e) => {
        const ev = (e as any).mapBrowserEvent as MapBrowserEvent<any>;
        const o = ev.originalEvent as MouseEvent;
        selectByMapPolygon(handle, box.getGeometry(), { shift: o.shiftKey, ctrl: o.ctrlKey || o.metaKey });
      });
      const onClick = (e: MapBrowserEvent<any>) => {
        const o = e.originalEvent as MouseEvent;
        selectAtPixel(handle, e.pixel, { shift: o.shiftKey, ctrl: o.ctrlKey || o.metaKey });
      };
      handle.map.addInteraction(box);
      handle.map.on('click', onClick);
      return () => {
        handle.map.removeInteraction(box);
        handle.map.un('click', onClick);
        handle.setDragPan(true);
      };
    },
  }, { description: 'Drag a box to select features; click selects one. Shift adds, Ctrl removes', keywords: 'select box marquee' });

  registerMapTool({ id: 'select-polygon', title: 'Select By Polygon', icon: Pentagon, cursor: 'crosshair', activate: drawTool('polygon') },
    { description: 'Click vertices, double-click to finish. Shift adds, Ctrl removes', keywords: 'select polygon' });
  registerMapTool({ id: 'select-lasso', title: 'Select By Lasso', icon: Lasso, cursor: 'crosshair', activate: drawTool('lasso') },
    { description: 'Draw a freehand shape around features. Shift adds, Ctrl removes', keywords: 'select freehand lasso' });
}

export function registerSelectionCommands() {
  registerCommand({
    id: 'select.clear', title: 'Clear Selection', icon: Eraser, description: 'Deselect all features', keywords: 'deselect',
    run: () => clearSelection(),
  });
  registerCommand({
    id: 'select.all', title: 'Select All', icon: ListChecks, description: 'Select every feature of the active layer',
    run: (arg) => {
      const t = resolveFeatureLayer(arg);
      if (t) setSelection(t.layer.id, layerFeatures(t.layer, t.dataset).map((f) => f.id), 'new');
    },
  });
  registerCommand({
    id: 'select.invert', title: 'Switch Selection', icon: FlipHorizontal2, description: 'Select what is unselected in the active layer', keywords: 'invert',
    run: (arg) => {
      const t = resolveFeatureLayer(arg);
      if (!t) return;
      const cur = new Set(getSelection(t.layer.id));
      setSelection(t.layer.id, layerFeatures(t.layer, t.dataset).map((f) => f.id).filter((id) => !cur.has(id)), 'new');
    },
  });
  registerCommand({
    id: 'select.zoomTo', title: 'Zoom To Selection', icon: Focus, description: 'Zoom the map to the selected features',
    run: (arg) => {
      if (!totalSelected()) return notify('No features are selected', 'info');
      const h = needHandle();
      if (!h) return;
      const layerId = typeof arg === 'string' ? arg : undefined;
      h.zoomToSelection(layerId);
    },
  });
}
