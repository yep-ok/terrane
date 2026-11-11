// Layer-management actions used by commands, menus and drag-and-drop. All project
// changes go through core/store.ts actions; structural changes record undo entries.
import type { Extent, GroupLayer, Id, Layer, MapDoc } from '../../core/types';
import { datasetExtent } from '../../core/data';
import { pushUndo, transaction } from '../../core/history';
import {
  addLayer, findLayer, getMap, makeGroupLayer, moveLayer, removeLayer, updateLayer,
} from '../../core/store';
import { uid } from '../../core/data';
import { activeLayerId, activeMapId, notify, pruneLayerState, setActiveLayer } from '../../core/ui';
import { openPane } from '../../core/registry';
import { getMapHandle } from '../../map/handle';
import {
  cloneSubtree, copyName, groupPlan, movesFor, parentOf, planIsNoop, siblingMovePlan, subtreeIds, topLevelSelection, treeOrder,
  type OrderPlan,
} from './tree';
import { cui, cuiGet, startRename } from './state';

// ---------- ordering ----------

/** Exact flat order and parents of a map, for undo. */
function snapshotPlan(mapId: Id): OrderPlan | null {
  const m = getMap(mapId);
  if (!m) return null;
  const parents: Record<Id, Id | null> = {};
  for (const l of m.layers) parents[l.id] = l.parentId ?? null;
  return { order: m.layers.map((l) => l.id), parents };
}

function applyPlanRaw(mapId: Id, plan: OrderPlan) {
  const m = getMap(mapId);
  if (!m) return;
  const cur = m.layers.map((l) => l.id);
  const have = new Set(cur);
  const target = plan.order.filter((id) => have.has(id));
  const inTarget = new Set(target);
  for (const id of cur) if (!inTarget.has(id)) target.push(id);
  for (const mv of movesFor(cur, target)) moveLayer(mv.id, mv.toIndex);
  for (const [id, parent] of Object.entries(plan.parents)) {
    const layers = getMap(mapId)?.layers ?? [];
    const index = layers.findIndex((l) => l.id === id);
    if (index >= 0 && (layers[index].parentId ?? null) !== parent) moveLayer(id, index, parent);
  }
}

/** Reorder / re-parent layers of a map with one undo step. */
export function applyPlan(mapId: Id, plan: OrderPlan, label = 'Reorder layers') {
  const m = getMap(mapId);
  if (!m || planIsNoop(m.layers, plan)) return;
  const before = snapshotPlan(mapId)!;
  applyPlanRaw(mapId, plan);
  const after = snapshotPlan(mapId)!;
  pushUndo({ label, undo: () => applyPlanRaw(mapId, before), redo: () => applyPlanRaw(mapId, after) });
}

export function moveSibling(layerId: Id, dir: 'up' | 'down') {
  const hit = findLayer(layerId);
  if (!hit) return;
  const plan = siblingMovePlan(hit.map.layers, layerId, dir);
  if (plan) applyPlan(hit.map.id, plan, dir === 'up' ? 'Move layer up' : 'Move layer down');
}

// ---------- targets ----------

/** Layers a command acts on: explicit id, else the multi-selection containing the active layer, else the active layer. */
export function targetIds(arg?: any): Id[] {
  if (typeof arg === 'string') return [arg];
  if (arg && typeof arg.layerId === 'string') return [arg.layerId];
  const active = activeLayerId();
  const { multi } = cuiGet();
  if (active && multi.length > 1 && multi.includes(active)) return multi.filter((id) => !!findLayer(id));
  return active && findLayer(active) ? [active] : [];
}

export function uniqueGroupName(mapId: Id, base = 'New Group Layer') {
  const names = (getMap(mapId)?.layers ?? []).map((l) => l.name);
  if (!names.includes(base)) return base;
  for (let i = 2; ; i++) if (!names.includes(`${base} ${i}`)) return `${base} ${i}`;
}

// ---------- add / remove / duplicate ----------

export function removeLayers(ids: Id[]) {
  const hit = findLayer(ids[0]);
  if (!hit) return;
  const mapId = hit.map.id;
  const layers = hit.map.layers;
  const tops = topLevelSelection(layers, ids);
  const doomed = new Set(tops.flatMap((id) => subtreeIds(layers, id)));
  const snap = layers.map((layer, index) => ({ layer, index })).filter((x) => doomed.has(x.layer.id));
  const remove = () => tops.forEach((id) => removeLayer(id));
  remove();
  pruneLayerState();
  cui((s) => ({ multi: s.multi.filter((id) => !doomed.has(id)), renamingId: null }));
  pushUndo({
    label: tops.length > 1 ? 'Remove layers' : 'Remove layer',
    undo: () => snap.forEach((x) => addLayer(mapId, x.layer, x.index)),
    redo: remove,
  });
}

export function addGroup(): Id | undefined {
  const mapId = activeMapId();
  if (!mapId) return void notify('Open a map first.', 'warning');
  const active = findLayer(activeLayerId());
  let index = 0;
  let parent: Id | null = null;
  if (active && active.map.id === mapId) {
    index = active.index;
    parent = active.layer.parentId ?? null;
  }
  const group = { ...makeGroupLayer(uniqueGroupName(mapId)), parentId: parent };
  addLayer(mapId, group, index);
  pushUndo({ label: 'New group layer', undo: () => removeLayer(group.id), redo: () => addLayer(mapId, group, index) });
  setActiveLayer(group.id);
  cui({ multi: [group.id], anchor: group.id });
  openPane('contents');
  startRename(group.id);
  return group.id;
}

/** Put the given layers into a new group (replacing the top-most one's position). */
export function groupLayers(ids: Id[]): Id | undefined {
  const hit = findLayer(ids[0]);
  if (!hit) return void notify('Select one or more layers to group.', 'warning');
  const mapId = hit.map.id;
  const tops = topLevelSelection(hit.map.layers, ids);
  if (!tops.length) return;
  let groupId: Id | undefined;
  transaction('Group layers', () => {
    const group: GroupLayer = makeGroupLayer(uniqueGroupName(mapId, 'Group'));
    addLayer(mapId, group, 0);
    pushUndo({ label: 'Add group', undo: () => removeLayer(group.id), redo: () => addLayer(mapId, group, 0) });
    const plan = groupPlan(getMap(mapId)!.layers, group.id, tops);
    if (plan) applyPlan(mapId, plan, 'Group layers');
    groupId = group.id;
  });
  if (groupId) {
    setActiveLayer(groupId);
    cui({ multi: [groupId], anchor: groupId });
    openPane('contents');
    startRename(groupId);
  }
  return groupId;
}

/** Dissolve a group: its children move to the group's parent. Given a non-group, dissolves its parent group. */
export function ungroup(layerId: Id) {
  const hit = findLayer(layerId);
  if (!hit) return;
  let group = hit.layer;
  if (group.kind !== 'group') {
    const pid = parentOf(hit.map.layers, layerId);
    const p = pid ? findLayer(pid) : undefined;
    if (!p) return void notify('This layer is not inside a group.', 'info');
    group = p.layer;
  }
  const mapId = hit.map.id;
  const before = snapshotPlan(mapId)!;
  const groupLayer = group;
  const index = getMap(mapId)!.layers.findIndex((l) => l.id === groupLayer.id);
  const parent = groupLayer.parentId ?? null;
  const children = getMap(mapId)!.layers.filter((l) => l.parentId === groupLayer.id).map((l) => l.id);
  const run = () => {
    for (const c of children) updateLayer(c, { parentId: parent });
    removeLayer(groupLayer.id);
  };
  run();
  pruneLayerState();
  pushUndo({
    label: 'Ungroup',
    undo: () => {
      addLayer(mapId, groupLayer, index);
      applyPlanRaw(mapId, before);
    },
    redo: run,
  });
  if (children[0]) setActiveLayer(children[0]);
}

export function duplicateLayers(ids: Id[]): Id[] {
  const hit = findLayer(ids[0]);
  if (!hit) return [];
  const mapId = hit.map.id;
  const tops = topLevelSelection(hit.map.layers, ids);
  const created: Id[] = [];
  transaction('Duplicate layer', () => {
    for (const id of tops) {
      const m = getMap(mapId)!;
      const index = m.layers.findIndex((l) => l.id === id);
      if (index < 0) continue;
      const parent = m.layers[index].parentId ?? null;
      const clones = cloneSubtree(m.layers, id, (l) => uid(l.kind === 'group' ? 'grp' : 'lyr')) as Layer[];
      const names = m.layers.filter((l) => (l.parentId ?? null) === parent).map((l) => l.name);
      clones[0].name = copyName(clones[0].name, names);
      clones.forEach((c, i) => addLayer(mapId, c, index + i));
      pushUndo({
        label: 'Duplicate layer',
        undo: () => removeLayer(clones[0].id),
        redo: () => clones.forEach((c, i) => addLayer(mapId, c, index + i)),
      });
      created.push(clones[0].id);
    }
  });
  if (created[0]) {
    setActiveLayer(created[0]);
    cui({ multi: created, anchor: created[0] });
  }
  return created;
}

// ---------- visibility ----------

export function setVisible(ids: Id[], visible: boolean) {
  for (const id of ids) updateLayer(id, { visible });
}

/** Show only one layer (and the groups that contain it); everything else is switched off. */
export function showOnly(layerId: Id) {
  const hit = findLayer(layerId);
  if (!hit) return;
  const keep = new Set<Id>([layerId]);
  let cur: Id | null = parentOf(hit.map.layers, layerId);
  for (let guard = 0; cur && guard < 50; guard++) {
    keep.add(cur);
    cur = parentOf(hit.map.layers, cur);
  }
  // Descendants of a chosen group keep their own state; everything else follows `keep`.
  const inside = new Set(hit.layer.kind === 'group' ? subtreeIds(hit.map.layers, layerId).slice(1) : []);
  for (const l of hit.map.layers) {
    const want = keep.has(l.id);
    if (!inside.has(l.id) && l.visible !== want) updateLayer(l.id, { visible: want });
  }
}

export function setAllVisible(mapId: Id, visible: boolean) {
  for (const l of getMap(mapId)?.layers ?? []) if (l.visible !== visible) updateLayer(l.id, { visible });
}

export function setAllExpanded(mapId: Id, expanded: boolean) {
  for (const l of getMap(mapId)?.layers ?? []) if (l.kind === 'group' && l.expanded !== expanded) updateLayer(l.id, { expanded });
}

/** Make `layerId` the only selectable feature layer of its map. */
export function onlySelectable(layerId: Id) {
  const hit = findLayer(layerId);
  if (!hit) return;
  for (const l of hit.map.layers) if (l.kind === 'feature' && l.selectable !== (l.id === layerId)) updateLayer(l.id, { selectable: l.id === layerId });
}

// ---------- extents / zoom ----------

export function layerExtent(map: MapDoc, layer: Layer): Extent | null {
  if (layer.kind === 'feature') return datasetExtent(layer.datasetId);
  if (layer.kind !== 'group') return null;
  let out: Extent | null = null;
  for (const id of subtreeIds(map.layers, layer.id).slice(1)) {
    const l = map.layers.find((x) => x.id === id);
    const e = l && l.kind === 'feature' ? datasetExtent(l.datasetId) : null;
    if (!e) continue;
    out = out ? [Math.min(out[0], e[0]), Math.min(out[1], e[1]), Math.max(out[2], e[2]), Math.max(out[3], e[3])] : [...e];
  }
  return out;
}

export function zoomToLayer(layerId: Id) {
  const hit = findLayer(layerId);
  if (!hit) return;
  const handle = getMapHandle(hit.map.id);
  if (!handle) return void notify('Open the map view to zoom to a layer.', 'info');
  const ext = layerExtent(hit.map, hit.layer);
  if (!ext) return void notify(hit.layer.kind === 'feature' || hit.layer.kind === 'group' ? 'This layer has no features to zoom to.' : 'This layer has no known extent.', 'info');
  if (hit.layer.kind === 'feature') handle.zoomToLayer(layerId);
  else handle.zoomToExtent(ext, { padding: 40 });
}

export function zoomToSelection(layerId: Id) {
  const hit = findLayer(layerId);
  const handle = hit && getMapHandle(hit.map.id);
  if (!handle) return void notify('Open the map view to zoom to the selection.', 'info');
  handle.zoomToSelection(layerId);
}

/** Display-ordered ids of a map (used for keyboard navigation fallbacks). */
export const orderedIds = (map: MapDoc) => treeOrder(map.layers).map((l) => l.id);
