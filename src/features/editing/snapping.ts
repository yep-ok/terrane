// Snapping for the edit tools: one ol/interaction/Snap per visible feature layer
// source (vertex + edge). Snap interactions must come after Draw/Modify in the
// interaction list, so tools call attachSnapping() last and the snapper re-appends
// itself whenever the layer set or settings change.
import Snap from 'ol/interaction/Snap';
import type VectorSource from 'ol/source/Vector';
import type { MapHandle } from '../../map/handle';
import { getMap, isLayerVisible, useProject } from '../../core/store';
import { useEdit } from './state';

export interface Snapper {
  /** Remove and re-add the snap interactions (call after adding a new Draw/Modify). */
  refresh(): void;
  dispose(): void;
}

export function attachSnapping(handle: MapHandle): Snapper {
  let snaps: Snap[] = [];
  let lastKey = '';
  let lastSources: VectorSource[] = [];
  let disposed = false;

  const sources = (): VectorSource[] => {
    const map = getMap(handle.mapId);
    const out: VectorSource[] = [];
    for (const l of map?.layers ?? []) {
      if (l.kind !== 'feature' || !isLayerVisible(map!, l)) continue;
      const src = handle.source(l.id);
      const ol = handle.olLayer(l.id);
      if (src && ol && ol.getVisible() && !out.includes(src)) out.push(src);
    }
    return out;
  };

  const remove = () => {
    for (const s of snaps) handle.map.removeInteraction(s);
    snaps = [];
  };

  const build = () => {
    remove();
    const { snapping, snapTolerance } = useEdit.getState();
    lastSources = sources();
    lastKey = `${snapping}|${snapTolerance}`;
    if (!snapping) return;
    for (const source of lastSources) {
      const s = new Snap({ source, pixelTolerance: snapTolerance, vertex: true, edge: true });
      handle.map.addInteraction(s);
      snaps.push(s);
    }
  };

  const changed = () => {
    if (disposed) return;
    const { snapping, snapTolerance } = useEdit.getState();
    const next = sources();
    const key = `${snapping}|${snapTolerance}`;
    if (key === lastKey && next.length === lastSources.length && next.every((s, i) => s === lastSources[i])) return;
    build();
  };

  build();
  // Project changes include view moves; changed() is a cheap no-op unless the source set differs.
  const unsubProject = useProject.subscribe(changed);
  const unsubEdit = useEdit.subscribe((s, p) => (s.snapping !== p.snapping || s.snapTolerance !== p.snapTolerance) && changed());

  return {
    refresh: () => !disposed && build(),
    dispose() {
      disposed = true;
      unsubProject();
      unsubEdit();
      remove();
    },
  };
}
