// Map tools 'edit-modify' (reshape vertices + drag to move) and 'edit-move' (drag /
// nudge only). The selected features of editable layers drive one shared OL
// Collection; each gesture commits ONE applyEdits update per layer.
import Collection from 'ol/Collection';
import type OlFeature from 'ol/Feature';
import OlFeatureCtor from 'ol/Feature';
import Modify from 'ol/interaction/Modify';
import Translate from 'ol/interaction/Translate';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import MultiPoint from 'ol/geom/MultiPoint';
import type SimpleGeometry from 'ol/geom/SimpleGeometry';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { primaryAction } from 'ol/events/condition';
import { Fill, RegularShape, Stroke, Style, Circle as CircleStyle } from 'ol/style';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import { createElement } from 'react';
import { ClipboardList, Eraser, Magnet, Move, PenTool, Trash2, Undo2 } from 'lucide-react';
import type { Id } from '../../core/types';
import type { MapHandle } from '../../map/handle';
import { featOf, layerIdOf } from '../../map/handle';
import { applyEdits, subscribeData, transaction } from '../../core/data';
import { findFeatureLayer, getMap, useProject } from '../../core/store';
import { clearSelection, notify, setSelection, showContextMenu, useUi } from '../../core/ui';
import { openPane, runCommand, getCommand } from '../../core/registry';
import { cleanGeometry } from './geom';
import { attachSnapping } from './snapping';
import { useEdit } from './state';
import { editableLayers, featureLayers, lockedMessage } from './util';
import { isTyping, mapHint } from './hint';

const MAX_FEATURES = 250;
const icon = (c: any) => createElement(c, { size: 14 });

const vertexStyle = new Style({
  image: new RegularShape({ points: 4, radius: 4.5, angle: Math.PI / 4, fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: '#1a1a1a', width: 1.2 }) }),
  geometry: (f) => {
    const g = (f.get('target') as OlFeature | undefined)?.getGeometry() as SimpleGeometry | undefined;
    if (!g || g.getType() === 'Point') return undefined;
    return new MultiPoint(g.getFlatCoordinates(), g.getLayout());
  },
});
const pointerStyle = new Style({
  image: new CircleStyle({ radius: 6, fill: new Fill({ color: 'rgba(47,129,247,0.35)' }), stroke: new Stroke({ color: '#2f81f7', width: 2 }) }),
});

/** Commit current OL geometries of features as one undoable step (one applyEdits per layer). */
export function commitGeometries(handle: MapHandle, features: OlFeature[], label: string) {
  const byLayer = new Map<Id, Array<{ id: number; geometry: any }>>();
  for (const f of features) {
    const layerId = layerIdOf(f);
    const feat = featOf(f);
    const geom = f.getGeometry();
    if (!layerId || !feat || !geom) continue;
    const list = byLayer.get(layerId) ?? [];
    list.push({ id: feat.id, geometry: cleanGeometry(handle.toGeoJSON(geom)) });
    byLayer.set(layerId, list);
  }
  const run = () => {
    for (const [layerId, updates] of byLayer) {
      const ref = findFeatureLayer(layerId);
      if (ref) applyEdits(ref.dataset.id, { updates }, { label });
    }
  };
  if (byLayer.size > 1) transaction(label, run);
  else run();
}

/** Put features back to their stored geometry (discarding an uncommitted gesture). */
function revert(handle: MapHandle, features: OlFeature[]) {
  for (const f of features) {
    const feat = featOf(f);
    if (feat?.geometry) f.setGeometry(handle.fromGeoJSON(feat.geometry));
  }
}

const flatCount = (features: OlFeature[]) =>
  features.reduce((n, f) => {
    const g = f.getGeometry() as SimpleGeometry | undefined;
    return n + (g ? g.getFlatCoordinates().length / g.getStride() : 0);
  }, 0);

export function activateModify(handle: MapHandle, mode: 'modify' | 'move'): () => void {
  const map = handle.map;
  const hint = mapHint(handle);
  const collection = new Collection<OlFeature>();
  const keys: EventsKey[] = [];

  // Vertex markers: proxy features that share the target's geometry.
  const proxySource = new VectorSource({ useSpatialIndex: false });
  const proxyLayer = new VectorLayer({ source: proxySource, zIndex: 99990, style: mode === 'modify' ? vertexStyle : undefined, properties: { role: 'edit-vertices' } });
  if (mode === 'modify') map.addLayer(proxyLayer);
  let proxyKeys: EventsKey[] = [];
  const rebuildProxies = () => {
    unByKey(proxyKeys);
    proxyKeys = [];
    proxySource.clear(true);
    if (mode !== 'modify') return;
    const proxies = collection.getArray().map((target) => {
      const p = new OlFeatureCtor({ geometry: target.getGeometry() });
      p.set('target', target, true);
      proxyKeys.push(target.on('change', () => {
        if (p.getGeometry() !== target.getGeometry()) p.setGeometry(target.getGeometry());
        else p.changed();
      }));
      return p;
    });
    proxySource.addFeatures(proxies);
  };

  const translate = new Translate({ features: collection, hitTolerance: 4, condition: primaryAction });
  map.addInteraction(translate);
  let modify: Modify | null = null;
  if (mode === 'modify') {
    modify = new Modify({
      features: collection,
      pixelTolerance: 8,
      style: pointerStyle,
      // Shift+drag leaves the gesture to Translate (move the whole feature).
      condition: (e) => primaryAction(e) && !e.originalEvent.shiftKey,
    });
    map.addInteraction(modify);
  }
  const snapper = mode === 'modify' ? attachSnapping(handle) : null;

  const describe = () => {
    const n = collection.getLength();
    if (mode === 'move')
      return n
        ? `Moving ${n} feature${n === 1 ? '' : 's'} · Drag a selected feature · Arrow keys nudge (Shift ×10) · Shift+click adds to the selection`
        : 'Click a feature of an editable layer to select it for moving';
    return n
      ? `Editing ${n} feature${n === 1 ? '' : 's'} · Drag vertices or edges · Alt+click deletes a vertex · Drag inside or Shift+drag moves · Esc ends`
      : 'Click a feature of an editable layer to edit its vertices · Shift+click adds to the selection';
  };

  // ----- selection -> collection -----
  const sync = () => {
    const doc = getMap(handle.mapId);
    const sel = useUi.getState().selection;
    const want: OlFeature[] = [];
    outer: for (const ref of editableLayers(doc, true)) {
      const src = handle.source(ref.layer.id);
      if (!src) continue;
      for (const fid of sel[ref.layer.id] ?? []) {
        const f = src.getFeatureById(fid) as OlFeature | null;
        if (f && f.getGeometry()) want.push(f);
        if (want.length >= MAX_FEATURES) break outer;
      }
    }
    const cur = collection.getArray();
    if (want.length !== cur.length || want.some((f, i) => f !== cur[i])) {
      collection.clear();
      collection.extend(want);
      rebuildProxies();
    }
    hint.set(describe());
  };
  sync();
  const unsubSel = useUi.subscribe((s, p) => s.selection !== p.selection && sync());
  // OL features are replaced when undo re-adds a deleted feature, layers are re-created, etc.
  const unsubProject = (() => {
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sync();
      });
    };
    const offData = subscribeData(schedule);
    const offProject = useProject.subscribe(schedule);
    return () => {
      cancelAnimationFrame(raf);
      offData();
      offProject();
    };
  })();

  // ----- gestures -----
  let startPixel: number[] | null = null;
  let startCount = 0;
  if (modify) {
    modify.on('modifystart', (e) => {
      startPixel = e.mapBrowserEvent?.pixel ?? null;
      startCount = flatCount(e.features.getArray());
    });
    modify.on('modifyend', (e) => {
      const feats = e.features.getArray().slice();
      const end = e.mapBrowserEvent?.pixel;
      const still = !!startPixel && !!end && Math.hypot(end[0] - startPixel[0], end[1] - startPixel[1]) < 2;
      if (still && flatCount(feats) > startCount) {
        // A plain click on an edge inserted a vertex without moving it: discard.
        queueMicrotask(() => revert(handle, feats));
        return;
      }
      commitGeometries(handle, feats, feats.length === 1 ? 'Reshape feature' : `Reshape ${feats.length} features`);
    });
  }
  let revisions = new Map<OlFeature, number>();
  translate.on('translatestart', () => {
    revisions = new Map(collection.getArray().map((f) => [f, f.getGeometry()?.getRevision() ?? 0]));
  });
  translate.on('translateend', () => {
    const moved = collection.getArray().filter((f) => (f.getGeometry()?.getRevision() ?? 0) !== revisions.get(f));
    if (moved.length) commitGeometries(handle, moved, moved.length === 1 ? 'Move feature' : `Move ${moved.length} features`);
  });

  // ----- click to select -----
  const isEditable = (layerId: Id) => editableLayers(getMap(handle.mapId)).some((x) => x.layer.id === layerId);
  const onClick = (e: MapBrowserEvent<any>) => {
    const oe = e.originalEvent as MouseEvent;
    if (oe.altKey) return; // Alt+click is vertex deletion
    const hits = handle.hitTest(e.pixel, { tolerance: 5 });
    const editable = hits.filter((h) => isEditable(h.layerId));
    const additive = oe.shiftKey || oe.ctrlKey || oe.metaKey;
    if (!editable.length) {
      if (hits.length) {
        const doc = getMap(handle.mapId);
        const locked = featureLayers(doc).filter((x) => hits.some((h) => h.layerId === x.layer.id));
        notify(lockedMessage(locked), 'warning');
      } else if (!additive) clearSelection();
      return;
    }
    // Prefer a feature already being edited, so clicking inside the current one does not jump layers.
    const inSet = editable.find((h) => collection.getArray().includes(h.olFeature));
    const h = additive ? editable[0] : inSet ?? editable[0];
    if (additive) setSelection(h.layerId, [h.fid], 'toggle');
    else {
      const sel = useUi.getState().selection;
      const already = Object.keys(sel).length === 1 && sel[h.layerId]?.length === 1 && sel[h.layerId][0] === h.fid;
      if (!already) {
        clearSelection();
        setSelection(h.layerId, [h.fid]);
      }
    }
  };
  keys.push(map.on('click', onClick));

  // ----- keyboard -----
  const nudge = (dx: number, dy: number) => {
    const feats = collection.getArray();
    if (!feats.length) return;
    const res = map.getView().getResolution() ?? 1;
    for (const f of feats) f.getGeometry()?.translate(dx * res, dy * res);
    commitGeometries(handle, feats.slice(), feats.length === 1 ? 'Nudge feature' : `Nudge ${feats.length} features`);
  };
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target) || useUi.getState().dialogs.length || useUi.getState().contextMenu) return;
    if (e.key === 'Escape' && collection.getLength()) {
      clearSelection();
      e.preventDefault();
      return;
    }
    if (mode !== 'move' || !collection.getLength() || e.ctrlKey || e.altKey || e.metaKey) return;
    const step = e.shiftKey ? 10 : 1;
    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const v = d[e.key];
    if (!v) return;
    e.preventDefault();
    e.stopPropagation();
    nudge(v[0], v[1]);
  };
  window.addEventListener('keydown', onKey, true);

  // ----- context menu -----
  const viewport = map.getViewport()!;
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const pixel = map.getEventPixel(e);
    let vertex: number[] | null = null;
    if (modify) {
      let best = 9;
      for (const f of collection.getArray()) {
        const g = f.getGeometry() as SimpleGeometry | undefined;
        if (!g || g.getType() === 'Point') continue;
        const flat = g.getFlatCoordinates();
        const stride = g.getStride();
        for (let i = 0; i < flat.length; i += stride) {
          const px = map.getPixelFromCoordinate([flat[i], flat[i + 1]]);
          const d = px ? Math.hypot(px[0] - pixel[0], px[1] - pixel[1]) : Infinity;
          if (d < best) {
            best = d;
            vertex = [flat[i], flat[i + 1]];
          }
        }
      }
    }
    const n = collection.getLength();
    const snapOn = useEdit.getState().snapping;
    const has = (id: string) => !!getCommand(id);
    showContextMenu(e, [
      ...(modify
        ? [{
            label: 'Delete Vertex', icon: icon(Undo2), disabled: !vertex,
            onClick: () => {
              if (vertex && !modify!.removePoint(vertex)) notify('That vertex cannot be removed: the shape needs at least the minimum number of vertices.', 'info');
            },
          }, 'separator' as const]
        : []),
      { label: n === 1 ? 'Delete Feature' : 'Delete Features', icon: icon(Trash2), disabled: !n, danger: true, onClick: () => runCommand('edit.delete') },
      mode === 'modify'
        ? { label: 'Move Tool', icon: icon(Move), onClick: () => runCommand('tool.edit-move') }
        : { label: 'Modify Vertices', icon: icon(PenTool), onClick: () => runCommand('tool.edit-modify') },
      { label: 'Attributes', icon: icon(ClipboardList), onClick: () => openPane('attributes') },
      ...(has('edit.snapping') ? [{ label: 'Snapping', icon: icon(Magnet), checked: snapOn, onClick: () => useEdit.setState({ snapping: !snapOn }) }] : []),
      'separator',
      { label: 'Clear Selection', icon: icon(Eraser), disabled: !n, onClick: () => clearSelection() },
    ]);
  };
  viewport.addEventListener('contextmenu', onContext);

  return () => {
    unsubSel();
    unsubProject();
    unByKey(keys);
    unByKey(proxyKeys);
    window.removeEventListener('keydown', onKey, true);
    viewport.removeEventListener('contextmenu', onContext);
    snapper?.dispose();
    if (modify) map.removeInteraction(modify);
    map.removeInteraction(translate);
    map.removeLayer(proxyLayer);
    proxySource.clear(true);
    collection.clear();
    hint.remove();
  };
}
