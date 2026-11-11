// Navigation commands, per-map extent history, bookmarks commands.
import {
  Bookmark as BookmarkIcon, BookmarkPlus, Compass, Crosshair, Eraser, Expand, Globe, Layers, Search,
  ArrowLeft, ArrowRight, ZoomIn, ZoomOut, Pencil,
} from 'lucide-react';
import type { Id, ViewState } from '../../core/types';
import { getMap, removeBookmark } from '../../core/store';
import { openDialog, useUi } from '../../core/ui';
import { openPane, registerCommand, registerMapPlugin } from '../../core/registry';
import type { MapHandle } from '../../map/handle';
import { clearMarkers } from './markers';
import { needHandle } from './util';

// ---------- extent history ----------

interface History {
  stack: ViewState[];
  index: number;
  timer: any;
  /** View we are navigating to; the resulting moveend must not be recorded. */
  expected: ViewState | null;
  handle: MapHandle;
}
const histories = new Map<Id, History>();
const MAX_HISTORY = 60;

const near = (a: ViewState, b: ViewState) => {
  const dz = Math.abs(a.zoom - b.zoom);
  const span = 360 / 2 ** Math.max(a.zoom, 0);
  return dz < 0.02 && Math.abs(a.center[0] - b.center[0]) < span * 0.002 && Math.abs(a.center[1] - b.center[1]) < span * 0.002;
};

function commit(h: History) {
  clearTimeout(h.timer);
  h.timer = null;
  const v = h.handle.getViewState();
  if (h.expected) {
    const ex = h.expected;
    h.expected = null;
    if (near(ex, v)) return;
  }
  const cur = h.stack[h.index];
  if (cur && near(cur, v)) return;
  h.stack = h.stack.slice(0, h.index + 1);
  h.stack.push(v);
  if (h.stack.length > MAX_HISTORY) h.stack.shift();
  h.index = h.stack.length - 1;
}

function step(dir: -1 | 1) {
  const handle = needHandle();
  const h = handle && histories.get(handle.mapId);
  if (!h) return;
  if (h.timer) commit(h);
  const i = h.index + dir;
  if (i < 0 || i >= h.stack.length) return;
  h.index = i;
  h.expected = h.stack[i];
  h.handle.setViewState(h.stack[i], true);
}

export function canStep(mapId: Id | null | undefined, dir: -1 | 1): boolean {
  const h = mapId ? histories.get(mapId) : undefined;
  if (!h) return false;
  const i = h.index + dir;
  return i >= 0 && i < h.stack.length;
}

export function registerHistoryPlugin() {
  registerMapPlugin((handle) => {
    const h: History = { stack: [handle.getViewState()], index: 0, timer: null, expected: null, handle };
    histories.set(handle.mapId, h);
    const onMoveEnd = () => {
      clearTimeout(h.timer);
      h.timer = setTimeout(() => commit(h), 350);
    };
    handle.map.on('moveend', onMoveEnd);
    return () => {
      clearTimeout(h.timer);
      handle.map.un('moveend', onMoveEnd);
      if (histories.get(handle.mapId) === h) histories.delete(handle.mapId);
    };
  });
}

// ---------- helpers used by menus ----------

export function zoomBy(handle: MapHandle, delta: number, center?: number[]) {
  const view = handle.map.getView();
  const z = view.getZoom() ?? 2;
  const target = Math.min(view.getMaxZoom(), Math.max(view.getMinZoom(), z + delta));
  view.animate({ zoom: target, ...(center ? { center } : {}), duration: 250 });
}

// ---------- commands ----------

const hasMap = () => !!useUi.getState().activeMapId;

export function registerNavigationCommands() {
  registerCommand({
    id: 'map.zoomFull', title: 'Full Extent', icon: Expand, shortcut: 'Insert', enabled: hasMap,
    description: 'Zoom to the extent of all layers', keywords: 'extent all home world',
    run: () => needHandle()?.zoomFull(),
  });
  registerCommand({
    id: 'map.zoomIn', title: 'Zoom In', icon: ZoomIn, enabled: hasMap,
    run: () => { const h = needHandle(); if (h) zoomBy(h, 1); },
  });
  registerCommand({
    id: 'map.zoomOut', title: 'Zoom Out', icon: ZoomOut, enabled: hasMap,
    run: () => { const h = needHandle(); if (h) zoomBy(h, -1); },
  });
  registerCommand({
    id: 'map.prevExtent', title: 'Previous Extent', icon: ArrowLeft, enabled: hasMap, shortcut: 'Alt+Left',
    description: 'Return to the previous map view', run: () => step(-1),
  });
  registerCommand({
    id: 'map.nextExtent', title: 'Next Extent', icon: ArrowRight, enabled: hasMap, shortcut: 'Alt+Right',
    description: 'Go forward in the map view history', run: () => step(1),
  });
  registerCommand({
    id: 'map.rotateReset', title: 'Reset North', icon: Compass, enabled: hasMap,
    description: 'Rotate the map so north is up', keywords: 'rotation bearing compass',
    run: () => needHandle()?.setViewState({ rotation: 0 }),
  });

  registerCommand({
    id: 'map.goToXY', title: 'Go To XY', icon: Crosshair, enabled: hasMap,
    description: 'Zoom to a coordinate (decimal degrees, DMS or UTM)', keywords: 'coordinate latitude longitude utm location',
    run: (arg) => {
      const h = needHandle();
      if (h) openDialog('nav-goto', { mapId: h.mapId, text: typeof arg?.text === 'string' ? arg.text : undefined });
    },
  });
  registerCommand({
    id: 'map.locate', title: 'Locate', icon: Search, enabled: hasMap,
    description: 'Search for a place name (OpenStreetMap Nominatim)', keywords: 'search address geocode place find',
    run: () => openPane('locate'),
  });
  registerCommand({
    id: 'map.clearMarkers', title: 'Clear Marker', icon: Eraser, enabled: hasMap,
    description: 'Remove the marker dropped by Go To XY or Locate',
    run: () => { const h = needHandle(); if (h) clearMarkers(h); },
  });

  registerCommand({
    id: 'map.bookmark.new', title: 'New Bookmark', icon: BookmarkPlus, enabled: hasMap,
    description: 'Save the current view as a bookmark',
    run: () => { const h = needHandle(); if (h) openDialog('nav-bookmark-new', { mapId: h.mapId }); },
  });
  registerCommand({
    id: 'map.bookmarks', title: 'Manage Bookmarks', icon: Pencil, enabled: hasMap,
    run: () => { const h = needHandle(); if (h) openDialog('nav-bookmarks', { mapId: h.mapId }); },
  });
  registerCommand({
    id: 'map.bookmark.go', title: 'Go To Bookmark', icon: BookmarkIcon,
    description: 'Zoom to a bookmark (argument: bookmark id)',
    run: (arg) => {
      const h = needHandle();
      if (!h) return;
      const id = typeof arg === 'string' ? arg : arg?.id;
      const bm = getMap(h.mapId)?.bookmarks.find((b) => b.id === id);
      if (bm) h.setViewState({ center: bm.center, zoom: bm.zoom, rotation: bm.rotation });
    },
  });
  registerCommand({
    id: 'map.bookmark.remove', title: 'Delete Bookmark',
    run: (arg) => {
      const h = needHandle();
      if (h) removeBookmark(h.mapId, typeof arg === 'string' ? arg : arg?.id);
    },
  });

  registerCommand({
    id: 'map.basemap', title: 'Basemap', icon: Layers, enabled: hasMap,
    description: 'Choose the map background', keywords: 'background tiles imagery streets',
    run: () => { const h = needHandle(); if (h) openDialog('nav-basemap', { mapId: h.mapId }); },
  });
  registerCommand({
    id: 'map.crs', title: 'Coordinate System', icon: Globe, enabled: hasMap,
    description: 'Change the map projection', keywords: 'crs projection epsg utm mercator',
    run: () => { const h = needHandle(); if (h) openDialog('nav-crs', { mapId: h.mapId }); },
  });
}
