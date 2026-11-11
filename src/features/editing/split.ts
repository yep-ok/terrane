// Map tool 'edit-split': draw a line to split the selected lines / polygons.
import Draw from 'ol/interaction/Draw';
import { primaryAction } from 'ol/events/condition';
import type { Position } from 'geojson';
import type { MapHandle } from '../../map/handle';
import { applyEdits, transaction } from '../../core/data';
import { notify, setSelection, useUi } from '../../core/ui';
import { splitGeometry } from './geom';
import { attachSnapping } from './snapping';
import { requireSelection } from './util';
import { isTyping, mapHint } from './hint';

/** Split every selected editable line/polygon crossed by `cutter`. Returns the number of features split. */
export function splitSelected(cutter: Position[]): number {
  const groups = requireSelection('split', { families: ['LineString', 'Polygon'] });
  if (!groups) return 0;
  let split = 0;
  let created = 0;
  let error: string | null = null;
  const newSel: Array<[string, number[]]> = [];
  transaction('Split features', () => {
    for (const g of groups) {
      const updates: Array<{ id: number; geometry: any }> = [];
      const adds: Array<{ geometry: any; properties: Record<string, any> }> = [];
      for (const f of g.feats) {
        if (!f.geometry) continue;
        let pieces;
        try {
          pieces = splitGeometry(f.geometry, cutter);
        } catch (err: any) {
          error = err?.message ?? String(err);
          continue;
        }
        if (!pieces || pieces.length < 2) continue;
        split++;
        updates.push({ id: f.id, geometry: pieces[0] });
        for (const p of pieces.slice(1)) adds.push({ geometry: p, properties: { ...f.properties } });
      }
      if (!updates.length) continue;
      const ids = applyEdits(g.dataset.id, { updates, adds }, { label: 'Split features' });
      created += ids.length;
      newSel.push([g.layer.id, [...g.feats.map((f) => f.id), ...ids]]);
    }
  });
  for (const [layerId, ids] of newSel) setSelection(layerId, ids, 'add');
  if (split) notify(`Split ${split} feature${split === 1 ? '' : 's'} into ${split + created} parts.`, 'success');
  else if (error) notify(`Split: ${error}.`, 'warning');
  else notify('The line does not cut any selected feature: it must cross a polygon from edge to edge, or cross a line.', 'info');
  return split;
}

export function activateSplit(handle: MapHandle): () => void {
  const hint = mapHint(handle);
  const updateHint = () => {
    const n = Object.values(useUi.getState().selection).reduce((a, b) => a + b.length, 0);
    hint.set(
      n
        ? `Split ${n} selected feature${n === 1 ? '' : 's'} · Click to draw the split line · Double-click or F2 to finish · Esc cancels`
        : 'Select the lines or polygons to split first, then draw a line across them',
    );
  };
  updateHint();
  const unsubSel = useUi.subscribe((s, p) => s.selection !== p.selection && updateHint());

  let sketching = false;
  const draw = new Draw({ type: 'LineString', condition: (e) => primaryAction(e), stopClick: true });
  draw.on('drawstart', () => (sketching = true));
  draw.on('drawabort', () => (sketching = false));
  draw.on('drawend', (e) => {
    sketching = false;
    const g = e.feature.getGeometry();
    if (!g) return;
    const gj = handle.toGeoJSON(g);
    if (gj.type !== 'LineString' || gj.coordinates.length < 2) return;
    try {
      splitSelected(gj.coordinates);
    } catch (err: any) {
      notify(`Split: ${err?.message ?? err}`, 'error');
    }
  });
  handle.map.addInteraction(draw);
  const snapper = attachSnapping(handle);

  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e.target) || useUi.getState().dialogs.length || !sketching) return;
    const k = e.key;
    let used = true;
    if (k === 'F2') draw.finishDrawing();
    else if (k === 'Escape' && !useUi.getState().contextMenu) draw.abortDrawing();
    else if (k === 'Backspace' || k === 'Delete' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'z')) draw.removeLastPoint();
    else used = false;
    if (used) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener('keydown', onKey, true);

  return () => {
    unsubSel();
    window.removeEventListener('keydown', onKey, true);
    snapper.dispose();
    draw.abortDrawing();
    handle.map.removeInteraction(draw);
    hint.remove();
  };
}
