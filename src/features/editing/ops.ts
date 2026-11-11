// Feature operations on the current selection. Each is one undoable step.
import type { Geometry } from 'geojson';
import type { Id } from '../../core/types';
import { applyEdits, featureById, getDataset, transaction } from '../../core/data';
import { findFeatureLayer } from '../../core/store';
import { clearSelection, notify, setSelection, useUi } from '../../core/ui';
import {
  bufferGeometry, explodeGeometry, familyOf, flipLine, mergeGeometries, pivotOf, rotateGeometry, scaleGeometry,
  type BufferUnits, type Family,
} from './geom';
import { useEdit } from './state';
import { activeMap, editableLayers, familyLabel, featureLayers, mapProperties, requireSelection, type SelGroup } from './util';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const countOf = (groups: SelGroup[]) => groups.reduce((n, g) => n + g.feats.length, 0);

/** Run per-layer edits as one undo step, labelled once. */
function inOneStep(label: string, fn: () => void) {
  transaction(label, fn);
}

export function deleteSelected() {
  const groups = requireSelection('delete');
  if (!groups) return;
  const n = countOf(groups);
  const label = `Delete ${plural(n, 'feature')}`;
  inOneStep(label, () => {
    for (const g of groups) applyEdits(g.dataset.id, { deletes: g.feats.map((f) => f.id) }, { label });
  });
  for (const g of groups) clearSelection(g.layer.id);
  notify(`Deleted ${plural(n, 'feature')}.`, 'success');
}

// ---------- clipboard ----------

export function copySelected() {
  const map = activeMap();
  const sel = useUi.getState().selection;
  // Copy works from any layer, editable or not.
  const refs = featureLayers(map).filter((r) => sel[r.layer.id]?.length);
  if (!refs.length) return notify('Select one or more features to copy.', 'info');
  const family = refs[0].dataset.geomType as Family;
  const used = refs.filter((r) => r.dataset.geomType === family);
  const items = used.flatMap((r) =>
    sel[r.layer.id]
      .map((id) => featureById(r.dataset.id, id))
      .filter((f) => f?.geometry)
      .map((f) => ({ geometry: f!.geometry as Geometry, properties: { ...f!.properties } })),
  );
  useEdit.setState({ clipboard: { family, sourceLayerId: used[0].layer.id, items } });
  const skipped = refs.length - used.length;
  notify(`Copied ${plural(items.length, `${familyLabel(family)} feature`)}.${skipped ? ` Features of other geometry types were not copied.` : ''}`, 'success');
}

/** Paste the clipboard into a layer (default: the active layer, if compatible). Returns false when a target is needed. */
export function paste(targetLayerId?: Id, opts: { attributes?: boolean } = {}): boolean {
  const clip = useEdit.getState().clipboard;
  if (!clip?.items.length) {
    notify('The clipboard is empty. Copy features first.', 'info');
    return true;
  }
  const map = activeMap();
  if (!map) {
    notify('Open a map first.', 'warning');
    return true;
  }
  const candidates = editableLayers(map).filter((r) => r.dataset.geomType === clip.family);
  let target = targetLayerId ? candidates.find((r) => r.layer.id === targetLayerId) : undefined;
  if (!target && !targetLayerId) {
    const active = useUi.getState().activeLayerId;
    target = candidates.find((r) => r.layer.id === active) ?? (candidates.length === 1 ? candidates[0] : candidates.find((r) => r.layer.id === clip.sourceLayerId));
  }
  if (!target) {
    if (!candidates.length) {
      notify(`No editable ${familyLabel(clip.family)} layer in this map to paste into.`, 'warning');
      return true;
    }
    return false;
  }
  const keep = opts.attributes !== false;
  const adds = clip.items.map((it) => ({ geometry: it.geometry, properties: keep ? mapProperties(it.properties, target!.dataset) : {} }));
  const ids = applyEdits(target.dataset.id, { adds }, { label: `Paste ${plural(adds.length, 'feature')}` });
  clearSelection();
  setSelection(target.layer.id, ids);
  notify(`Pasted ${plural(ids.length, 'feature')} into "${target.layer.name}".`, 'success');
  return true;
}

export function duplicateSelected() {
  const groups = requireSelection('duplicate');
  if (!groups) return;
  const n = countOf(groups);
  const label = `Duplicate ${plural(n, 'feature')}`;
  const made: Array<[Id, number[]]> = [];
  inOneStep(label, () => {
    for (const g of groups) {
      const ids = applyEdits(g.dataset.id, { adds: g.feats.map((f) => ({ geometry: f.geometry, properties: { ...f.properties } })) }, { label });
      made.push([g.layer.id, ids]);
    }
  });
  clearSelection();
  for (const [layerId, ids] of made) setSelection(layerId, ids);
  notify(`Duplicated ${plural(n, 'feature')} in place. The copies are selected.`, 'success');
}

// ---------- merge / explode ----------

/** Merge features of one layer into the survivor (which keeps its attributes). */
export function mergeFeatures(layerId: Id, fids: number[], survivor: number) {
  const ref = findFeatureLayer(layerId);
  if (!ref) return;
  const feats = fids.map((id) => featureById(ref.dataset.id, id)).filter(Boolean);
  const geometry = mergeGeometries(feats.map((f) => f!.geometry));
  if (!geometry) return notify('Merge produced an empty geometry.', 'error');
  const label = `Merge ${plural(feats.length, 'feature')}`;
  applyEdits(ref.dataset.id, { updates: [{ id: survivor, geometry }], deletes: fids.filter((id) => id !== survivor) }, { label });
  clearSelection();
  setSelection(layerId, [survivor]);
  notify(`Merged ${plural(feats.length, 'feature')} into one ${geometry.type}.`, 'success');
}

export function explodeSelected() {
  const groups = requireSelection('explode');
  if (!groups) return;
  let exploded = 0;
  let created = 0;
  const sel: Array<[Id, number[]]> = [];
  inOneStep('Explode multipart features', () => {
    for (const g of groups) {
      const updates: Array<{ id: number; geometry: Geometry }> = [];
      const adds: Array<{ geometry: Geometry; properties: Record<string, any> }> = [];
      for (const f of g.feats) {
        if (!f.geometry) continue;
        const parts = explodeGeometry(f.geometry);
        if (parts.length < 2) continue;
        exploded++;
        updates.push({ id: f.id, geometry: parts[0] });
        for (const p of parts.slice(1)) adds.push({ geometry: p, properties: { ...f.properties } });
      }
      if (!updates.length) continue;
      const ids = applyEdits(g.dataset.id, { updates, adds }, { label: 'Explode multipart features' });
      created += ids.length;
      sel.push([g.layer.id, [...updates.map((u) => u.id), ...ids]]);
    }
  });
  if (!exploded) return notify('None of the selected features has more than one part.', 'info');
  for (const [layerId, ids] of sel) setSelection(layerId, ids, 'add');
  notify(`Exploded ${plural(exploded, 'feature')} into ${exploded + created} single-part features.`, 'success');
}

// ---------- geometry transforms ----------

/** Replace each selected feature's geometry with fn(geometry). */
function transformSelected(verb: string, label: string, fn: (g: Geometry, all: SelGroup[]) => Geometry | null, families?: Family[]) {
  const groups = requireSelection(verb, { families });
  if (!groups) return;
  let n = 0;
  inOneStep(label, () => {
    for (const g of groups) {
      const updates: Array<{ id: number; geometry: Geometry }> = [];
      for (const f of g.feats) {
        if (!f.geometry) continue;
        const next = fn(f.geometry, groups);
        if (next) updates.push({ id: f.id, geometry: next });
      }
      if (updates.length) applyEdits(g.dataset.id, { updates }, { label });
      n += updates.length;
    }
  });
  return n;
}

export function flipSelected() {
  const n = transformSelected('flip', 'Flip line direction', (g) => flipLine(g), ['LineString']);
  if (n) notify(`Reversed the direction of ${plural(n, 'line')}.`, 'success');
}

export type PivotMode = 'each' | 'selection';

function selectionPivot(groups: SelGroup[]) {
  return pivotOf(groups.flatMap((g) => g.feats.map((f) => f.geometry)));
}

export function rotateSelected(angle: number, pivot: PivotMode) {
  let shared: number[] | null = null;
  const n = transformSelected('rotate', `Rotate ${angle}°`, (g, groups) => {
    const p = pivot === 'selection' ? (shared ??= selectionPivot(groups)) : pivotOf([g]);
    return p ? rotateGeometry(g, angle, p) : null;
  });
  if (n) notify(`Rotated ${plural(n, 'feature')} by ${angle}°.`, 'success');
}

export function scaleSelected(factor: number, pivot: PivotMode) {
  let shared: number[] | null = null;
  const n = transformSelected('scale', `Scale ×${factor}`, (g, groups) => {
    const p = pivot === 'selection' ? (shared ??= selectionPivot(groups)) : pivotOf([g]);
    return p ? scaleGeometry(g, factor, p) : null;
  });
  if (n) notify(`Scaled ${plural(n, 'feature')} by ×${factor}.`, 'success');
}

export type BufferTarget = { mode: 'replace' } | { mode: 'layer'; layerId: Id };

export function bufferSelected(distance: number, units: BufferUnits, target: BufferTarget) {
  const groups = requireSelection('buffer');
  if (!groups) return;
  const results: Array<{ group: SelGroup; id: number; geometry: Geometry }> = [];
  let failed = 0;
  for (const g of groups)
    for (const f of g.feats) {
      if (!f.geometry) continue;
      const out = bufferGeometry(f.geometry, distance, units);
      if (out && familyOf(out) === 'Polygon') results.push({ group: g, id: f.id, geometry: out });
      else failed++;
    }
  if (!results.length) return notify('The buffer produced no geometry (a negative distance may have removed the whole shape).', 'warning');
  const label = `Buffer ${plural(results.length, 'feature')}`;
  if (target.mode === 'replace') {
    const bad = groups.filter((g) => g.dataset.geomType !== 'Polygon');
    if (bad.length) return notify(`Buffers can only replace polygon features. Choose a polygon layer to add them to instead.`, 'warning');
    inOneStep(label, () => {
      for (const g of groups) {
        const updates = results.filter((r) => r.group === g).map((r) => ({ id: r.id, geometry: r.geometry }));
        if (updates.length) applyEdits(g.dataset.id, { updates }, { label });
      }
    });
  } else {
    const ref = findFeatureLayer(target.layerId);
    const ds = ref && getDataset(ref.layer.datasetId);
    if (!ref || !ds || ds.geomType !== 'Polygon') return notify('Choose a polygon layer for the buffers.', 'warning');
    const adds = results.map((r) => {
      const src = r.group.feats.find((f) => f.id === r.id)!;
      return { geometry: r.geometry, properties: mapProperties(src.properties, ds) };
    });
    const ids = applyEdits(ds.id, { adds }, { label });
    clearSelection();
    setSelection(ref.layer.id, ids);
  }
  notify(`Buffered ${plural(results.length, 'feature')}${failed ? ` (${failed} produced no geometry)` : ''}.`, failed ? 'warning' : 'success');
}
