// Pure layer-tree helpers for Contents: ordering, drag-and-drop planning, grouping,
// cloning. No React / OpenLayers / store imports so they can be unit-tested in node.
import type { Id } from '../../core/types';

/** Structural subset of Layer used by the helpers. */
export interface LNode {
  id: Id;
  kind: string;
  parentId?: Id | null;
  minZoom?: number;
  maxZoom?: number;
  visible?: boolean;
}

/** A reorder: the new flat order (ids) and parent overrides for the layers that changed parent. */
export interface OrderPlan {
  order: Id[];
  parents: Record<Id, Id | null>;
}

export type DropZone = 'before' | 'after' | 'inside' | 'end';

function parentKey(l: LNode, ids: Set<Id>): Id | null {
  return l.parentId && l.parentId !== l.id && ids.has(l.parentId) ? l.parentId : null;
}

function kidsMap<T extends LNode>(layers: T[]): Map<Id | null, T[]> {
  const ids = new Set(layers.map((l) => l.id));
  const kids = new Map<Id | null, T[]>();
  for (const l of layers) {
    const k = parentKey(l, ids);
    const arr = kids.get(k);
    if (arr) arr.push(l);
    else kids.set(k, [l]);
  }
  return kids;
}

/** Parent id of a layer within the list (null when top level or the parent is missing). */
export function parentOf(layers: LNode[], id: Id): Id | null {
  const ids = new Set(layers.map((l) => l.id));
  const l = layers.find((x) => x.id === id);
  return l ? parentKey(l, ids) : null;
}

/**
 * Depth-first order where every group is followed by its descendants. Layers whose parent
 * is missing become top level; cycles are broken. Sibling order follows the flat list.
 */
export function treeOrder<T extends LNode>(layers: T[]): T[] {
  const kids = kidsMap(layers);
  const out: T[] = [];
  const seen = new Set<Id>();
  const walk = (p: Id | null) => {
    for (const c of kids.get(p) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  for (const l of layers)
    if (!seen.has(l.id)) {
      seen.add(l.id);
      out.push(l);
      walk(l.id);
    }
  return out;
}

/** [id, ...descendants] in tree order. */
export function subtreeIds(layers: LNode[], id: Id): Id[] {
  const kids = kidsMap(layers);
  const out: Id[] = [];
  const seen = new Set<Id>();
  const walk = (x: Id) => {
    if (seen.has(x)) return;
    seen.add(x);
    out.push(x);
    for (const c of kids.get(x) ?? []) walk(c.id);
  };
  if (layers.some((l) => l.id === id)) walk(id);
  return out;
}

export const descendantIds = (layers: LNode[], id: Id): Id[] => subtreeIds(layers, id).slice(1);

/** Ancestor ids, nearest first. */
export function ancestorIds(layers: LNode[], id: Id): Id[] {
  const ids = new Set(layers.map((l) => l.id));
  const byId = new Map(layers.map((l) => [l.id, l]));
  const out: Id[] = [];
  let cur = byId.get(id);
  for (let guard = 0; cur && guard < 50; guard++) {
    const p = parentKey(cur, ids);
    if (!p || out.includes(p)) break;
    out.push(p);
    cur = byId.get(p);
  }
  return out;
}

export interface Row<T extends LNode = LNode> {
  layer: T;
  depth: number;
}

/** Tree rows for display; descendants of collapsed groups are omitted. */
export function visibleRows<T extends LNode & { expanded?: boolean }>(layers: T[], isExpanded: (l: T) => boolean = (l) => l.expanded !== false): Row<T>[] {
  const kids = kidsMap(layers);
  const rows: Row<T>[] = [];
  const seen = new Set<Id>();
  const walk = (p: Id | null, depth: number) => {
    for (const c of kids.get(p) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      rows.push({ layer: c, depth });
      if (c.kind !== 'group' || isExpanded(c)) walk(c.id, depth + 1);
      else markSeen(c.id);
    }
  };
  const markSeen = (p: Id) => {
    for (const c of kids.get(p) ?? []) {
      seen.add(c.id);
      markSeen(c.id);
    }
  };
  walk(null, 0);
  return rows;
}

/** True when every ancestor group of the layer is visible. */
export function ancestorsVisible(layers: LNode[], id: Id): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  return ancestorIds(layers, id).every((a) => byId.get(a)?.visible !== false);
}

/** Whether the layer is displayed at this zoom level (either bound may be absent). */
export function inZoomRange(l: Pick<LNode, 'minZoom' | 'maxZoom'>, zoom: number): boolean {
  if (l.minZoom != null && zoom < l.minZoom) return false;
  if (l.maxZoom != null && zoom > l.maxZoom) return false;
  return true;
}

// ---------- drag and drop / reordering ----------

/**
 * Plan moving `dragId` (with all its descendants, kept contiguous) relative to `targetId`.
 * zone 'before' / 'after' place it as a sibling of the target (after = past the target's
 * whole subtree); 'inside' makes it the first child of a group; 'end' puts it at the bottom
 * of the top level. Returns null for impossible drops (onto itself/descendant, into a non-group).
 */
export function resolveDrop(layers: LNode[], dragId: Id, targetId: Id | null, zone: DropZone): OrderPlan | null {
  const ordered = treeOrder(layers);
  if (!ordered.some((l) => l.id === dragId)) return null;
  const ids = new Set(ordered.map((l) => l.id));
  const block = subtreeIds(ordered, dragId);
  const blockSet = new Set(block);
  const rest = ordered.filter((l) => !blockSet.has(l.id));
  let pos: number;
  let parent: Id | null;
  if (zone === 'end' || targetId == null) {
    pos = rest.length;
    parent = null;
  } else {
    if (blockSet.has(targetId)) return null;
    const ti = rest.findIndex((l) => l.id === targetId);
    if (ti < 0) return null;
    const t = rest[ti];
    if (zone === 'inside') {
      if (t.kind !== 'group') return null;
      parent = t.id;
      pos = ti + 1;
    } else if (zone === 'before') {
      parent = parentKey(t, ids);
      pos = ti;
    } else {
      parent = parentKey(t, ids);
      pos = ti + subtreeIds(rest, t.id).length;
    }
  }
  const order = [...rest.slice(0, pos).map((l) => l.id), ...block, ...rest.slice(pos).map((l) => l.id)];
  return { order, parents: { [dragId]: parent } };
}

/** True when applying the plan would change nothing. */
export function planIsNoop(layers: LNode[], plan: OrderPlan): boolean {
  const cur = treeOrder(layers);
  const ids = new Set(cur.map((l) => l.id));
  if (cur.some((l, i) => l.id !== plan.order[i])) return false;
  return cur.every((l) => !(l.id in plan.parents) || plan.parents[l.id] === parentKey(l, ids));
}

/** Position of `id` after the store's moveLayer(id, toIndex) semantics (remove, then insert at toIndex-1 if it came from before). */
export function simulateMove(list: Id[], id: Id, toIndex: number): Id[] {
  const from = list.indexOf(id);
  if (from < 0) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(Math.max(0, Math.min(from < toIndex ? toIndex - 1 : toIndex, next.length)), 0, id);
  return next;
}

/** Successive moveLayer(id, toIndex) calls that turn `current` into `target` (same members). */
export function movesFor(current: Id[], target: Id[]): Array<{ id: Id; toIndex: number }> {
  const cur = [...current];
  const moves: Array<{ id: Id; toIndex: number }> = [];
  for (let i = 0; i < target.length; i++) {
    if (cur[i] === target[i]) continue;
    const from = cur.indexOf(target[i]);
    if (from < 0) continue;
    // `from` is always after `i` here (earlier slots are settled), so toIndex === i.
    moves.push({ id: target[i], toIndex: i });
    cur.splice(from, 1);
    cur.splice(i, 0, target[i]);
  }
  return moves;
}

/** Move a layer one step among its siblings. */
export function siblingMovePlan(layers: LNode[], id: Id, dir: 'up' | 'down'): OrderPlan | null {
  const ordered = treeOrder(layers);
  const ids = new Set(ordered.map((l) => l.id));
  const l = ordered.find((x) => x.id === id);
  if (!l) return null;
  const p = parentKey(l, ids);
  const sibs = ordered.filter((x) => parentKey(x, ids) === p);
  const i = sibs.findIndex((x) => x.id === id);
  const n = sibs[i + (dir === 'up' ? -1 : 1)];
  return n ? resolveDrop(layers, id, n.id, dir === 'up' ? 'before' : 'after') : null;
}

/**
 * Plan placing `memberIds` inside the (already present) group `groupId`. The group takes the
 * place of the top-most member; members whose ancestor is also a member ride along with it.
 */
export function groupPlan(layers: LNode[], groupId: Id, memberIds: Id[]): OrderPlan | null {
  const ordered = treeOrder(layers);
  const ids = new Set(ordered.map((l) => l.id));
  const wanted = new Set(memberIds.filter((m) => m !== groupId));
  const tops = ordered.filter((l) => wanted.has(l.id) && !ancestorIds(ordered, l.id).some((a) => wanted.has(a)));
  if (!tops.length || !ids.has(groupId)) return null;
  const memberBlock = tops.flatMap((t) => subtreeIds(ordered, t.id));
  const block = [groupId, ...memberBlock];
  const blockSet = new Set(block);
  const firstIndex = ordered.findIndex((l) => l.id === tops[0].id);
  const pos = ordered.slice(0, firstIndex).filter((l) => !blockSet.has(l.id)).length;
  const rest = ordered.filter((l) => !blockSet.has(l.id)).map((l) => l.id);
  const order = [...rest.slice(0, pos), ...block, ...rest.slice(pos)];
  const parents: Record<Id, Id | null> = { [groupId]: parentKey(tops[0], ids) };
  for (const t of tops) parents[t.id] = groupId;
  return { order, parents };
}

/** Top-level members of a selection (drops layers whose ancestor group is also selected). */
export function topLevelSelection(layers: LNode[], selected: Id[]): Id[] {
  const set = new Set(selected);
  return treeOrder(layers)
    .filter((l) => set.has(l.id) && !ancestorIds(layers, l.id).some((a) => set.has(a)))
    .map((l) => l.id);
}

// ---------- cloning ----------

/** Deep-clone layers (tree order) with fresh ids; parent links inside the set are remapped. */
export function cloneLayers<T extends LNode>(layers: T[], newId: (old: T) => Id): T[] {
  const ordered = treeOrder(layers);
  const idMap = new Map<Id, Id>();
  for (const l of ordered) idMap.set(l.id, newId(l));
  return ordered.map((l) => {
    const c = structuredClone(l);
    c.id = idMap.get(l.id)!;
    c.parentId = l.parentId && idMap.has(l.parentId) ? idMap.get(l.parentId)! : l.parentId ?? null;
    return c;
  });
}

/** Clone one layer and its descendants. Parent of the root clone is unchanged. */
export function cloneSubtree<T extends LNode>(layers: T[], rootId: Id, newId: (old: T) => Id): T[] {
  const set = new Set(subtreeIds(layers, rootId));
  const subset = treeOrder(layers).filter((l) => set.has(l.id));
  return cloneLayers(subset, newId).map((c, i) => (i === 0 ? { ...c, parentId: subset[0].parentId ?? null } : c));
}

/** "Roads" -> "Roads copy" -> "Roads copy 2" without clashing with `taken`. */
export function copyName(name: string, taken: string[]): string {
  const base = name.replace(/ copy( \d+)?$/, '');
  let n = `${base} copy`;
  for (let i = 2; taken.includes(n); i++) n = `${base} copy ${i}`;
  return n;
}
