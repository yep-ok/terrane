import { describe, expect, it } from 'vitest';
import {
  ancestorIds, ancestorsVisible, cloneLayers, cloneSubtree, copyName, descendantIds, groupPlan, inZoomRange, movesFor,
  planIsNoop, resolveDrop, simulateMove, siblingMovePlan, topLevelSelection, treeOrder, visibleRows, type LNode, type OrderPlan,
} from './tree';

const L = (id: string, parentId: string | null = null, kind = 'feature'): LNode & { expanded?: boolean } => ({ id, kind, parentId, visible: true, ...(kind === 'group' ? { expanded: true } : {}) });
const ids = (ls: LNode[]) => ls.map((l) => l.id);

// A, G(B, C, H(D)), E
const sample = () => [L('A'), L('G', null, 'group'), L('B', 'G'), L('C', 'G'), L('H', 'G', 'group'), L('D', 'H'), L('E')];

/** Apply a plan the way the UI does (moveLayer calls then parent overrides). */
function apply(layers: LNode[], plan: OrderPlan): LNode[] {
  let order = ids(layers);
  for (const m of movesFor(order, plan.order)) order = simulateMove(order, m.id, m.toIndex);
  const byId = new Map(layers.map((l) => [l.id, { ...l }]));
  for (const [id, p] of Object.entries(plan.parents)) byId.get(id)!.parentId = p;
  return order.map((i) => byId.get(i)!);
}

describe('tree order', () => {
  it('keeps children contiguous after their group', () => {
    const messy = [L('B', 'G'), L('A'), L('G', null, 'group'), L('C', 'G')];
    expect(ids(treeOrder(messy))).toEqual(['A', 'G', 'B', 'C']);
  });
  it('treats missing parents as top level and survives cycles', () => {
    const odd = [L('X', 'nope'), L('P', 'Q', 'group'), L('Q', 'P', 'group')];
    expect(ids(treeOrder(odd)).sort()).toEqual(['P', 'Q', 'X']);
  });
  it('lists descendants and ancestors', () => {
    expect(descendantIds(sample(), 'G')).toEqual(['B', 'C', 'H', 'D']);
    expect(ancestorIds(sample(), 'D')).toEqual(['H', 'G']);
  });
  it('visibleRows hides collapsed groups and reports depth', () => {
    const layers = sample();
    (layers[4] as any).expanded = false;
    expect(visibleRows(layers as any).map((r) => `${r.layer.id}:${r.depth}`)).toEqual(['A:0', 'G:0', 'B:1', 'C:1', 'H:1', 'E:0']);
  });
  it('ancestor visibility and zoom range', () => {
    const layers = sample();
    layers[1].visible = false;
    expect(ancestorsVisible(layers, 'B')).toBe(false);
    expect(ancestorsVisible(layers, 'A')).toBe(true);
    expect(inZoomRange({ minZoom: 4 }, 3)).toBe(false);
    expect(inZoomRange({ maxZoom: 4 }, 5)).toBe(false);
    expect(inZoomRange({}, 5)).toBe(true);
  });
});

describe('resolveDrop', () => {
  it('moves a layer before / after a sibling', () => {
    const p = resolveDrop(sample(), 'E', 'A', 'before')!;
    expect(p.order).toEqual(['E', 'A', 'G', 'B', 'C', 'H', 'D']);
    const q = resolveDrop(sample(), 'A', 'E', 'after')!;
    expect(q.order).toEqual(['G', 'B', 'C', 'H', 'D', 'E', 'A']);
  });
  it('moves a group together with all descendants', () => {
    const p = resolveDrop(sample(), 'G', 'E', 'after')!;
    expect(p.order).toEqual(['A', 'E', 'G', 'B', 'C', 'H', 'D']);
    const out = apply(sample(), p);
    expect(ids(treeOrder(out))).toEqual(ids(out));
    expect(out.find((l) => l.id === 'D')!.parentId).toBe('H');
  });
  it('drops inside a group as first child and re-parents', () => {
    const p = resolveDrop(sample(), 'A', 'G', 'inside')!;
    expect(p.order).toEqual(['G', 'A', 'B', 'C', 'H', 'D', 'E']);
    expect(p.parents).toEqual({ A: 'G' });
  });
  it('drag out of a group puts the layer at the target level', () => {
    const p = resolveDrop(sample(), 'B', 'E', 'before')!;
    expect(p.parents).toEqual({ B: null });
    const out = apply(sample(), p);
    expect(ids(out)).toEqual(['A', 'G', 'C', 'H', 'D', 'B', 'E']);
  });
  it('"after" a group lands past its whole subtree', () => {
    const p = resolveDrop(sample(), 'A', 'G', 'after')!;
    expect(p.order).toEqual(['G', 'B', 'C', 'H', 'D', 'A', 'E']);
    expect(p.parents).toEqual({ A: null });
  });
  it('"end" appends at top level', () => {
    const p = resolveDrop(sample(), 'B', null, 'end')!;
    expect(p.order[p.order.length - 1]).toBe('B');
    expect(p.parents).toEqual({ B: null });
  });
  it('rejects dropping onto itself, its own descendants, or into a non-group', () => {
    expect(resolveDrop(sample(), 'G', 'G', 'before')).toBeNull();
    expect(resolveDrop(sample(), 'G', 'D', 'after')).toBeNull();
    expect(resolveDrop(sample(), 'G', 'H', 'inside')).toBeNull();
    expect(resolveDrop(sample(), 'A', 'E', 'inside')).toBeNull();
    expect(resolveDrop(sample(), 'nope', 'E', 'before')).toBeNull();
  });
  it('detects no-op plans', () => {
    expect(planIsNoop(sample(), resolveDrop(sample(), 'A', 'G', 'before')!)).toBe(true);
    expect(planIsNoop(sample(), resolveDrop(sample(), 'E', 'A', 'before')!)).toBe(false);
  });
  it('nesting a group into another group keeps subtrees intact', () => {
    const layers = [L('G1', null, 'group'), L('a', 'G1'), L('G2', null, 'group'), L('b', 'G2')];
    const out = apply(layers, resolveDrop(layers, 'G2', 'G1', 'inside')!);
    expect(ids(out)).toEqual(['G1', 'G2', 'b', 'a']);
    expect(out.find((l) => l.id === 'G2')!.parentId).toBe('G1');
    expect(ids(treeOrder(out))).toEqual(ids(out));
  });
});

describe('moves', () => {
  it('movesFor + simulateMove reproduce the target for random permutations', () => {
    const base = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (let n = 0; n < 50; n++) {
      const target = [...base].sort(() => Math.random() - 0.5);
      let cur = [...base];
      for (const m of movesFor(cur, target)) cur = simulateMove(cur, m.id, m.toIndex);
      expect(cur).toEqual(target);
    }
  });
  it('siblingMovePlan steps over whole sibling subtrees', () => {
    const down = siblingMovePlan(sample(), 'A', 'down')!;
    expect(down.order).toEqual(['G', 'B', 'C', 'H', 'D', 'A', 'E']);
    const up = siblingMovePlan(sample(), 'E', 'up')!;
    expect(up.order).toEqual(['A', 'E', 'G', 'B', 'C', 'H', 'D']);
    expect(siblingMovePlan(sample(), 'A', 'up')).toBeNull();
    expect(siblingMovePlan(sample(), 'E', 'down')).toBeNull();
    expect(siblingMovePlan(sample(), 'C', 'up')!.order).toEqual(['A', 'G', 'C', 'B', 'H', 'D', 'E']);
  });
});

describe('grouping', () => {
  it('groups members under a new group at the top-most member position', () => {
    const layers = [L('A'), L('B'), L('C'), L('D'), L('N', null, 'group')];
    const p = groupPlan(layers, 'N', ['D', 'B'])!;
    expect(p.order).toEqual(['A', 'N', 'B', 'D', 'C']);
    expect(p.parents).toEqual({ N: null, B: 'N', D: 'N' });
  });
  it('carries descendants of selected groups and ignores nested selections', () => {
    const layers = [...sample(), L('N', null, 'group')];
    const p = groupPlan(layers, 'N', ['G', 'D', 'E'])!;
    expect(p.order).toEqual(['A', 'N', 'G', 'B', 'C', 'H', 'D', 'E']);
    expect(p.parents).toEqual({ N: null, G: 'N', E: 'N' });
  });
  it('inherits the parent of the first member', () => {
    const layers = [...sample(), L('N', null, 'group')];
    const p = groupPlan(layers, 'N', ['B', 'C'])!;
    expect(p.parents.N).toBe('G');
  });
  it('returns null with no members', () => {
    expect(groupPlan([L('N', null, 'group')], 'N', [])).toBeNull();
  });
  it('topLevelSelection drops children of selected groups', () => {
    expect(topLevelSelection(sample(), ['D', 'G', 'A'])).toEqual(['A', 'G']);
  });
});

describe('cloning', () => {
  it('clones a subtree with new ids and remapped parents', () => {
    let n = 0;
    const out = cloneSubtree(sample(), 'G', () => `n${++n}`);
    expect(ids(out)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(out[0].parentId).toBeNull();
    expect(out[1].parentId).toBe('n1');
    expect(out[4].parentId).toBe('n4');
  });
  it('clone of a nested layer keeps its original parent', () => {
    const out = cloneSubtree(sample(), 'B', () => 'x');
    expect(out).toHaveLength(1);
    expect(out[0].parentId).toBe('G');
  });
  it('cloneLayers does not share nested objects', () => {
    const src = [{ ...L('A'), renderer: { c: 1 } }];
    const out = cloneLayers(src, () => 'z');
    out[0].renderer.c = 2;
    expect(src[0].renderer.c).toBe(1);
  });
  it('copyName avoids collisions', () => {
    expect(copyName('Roads', ['Roads'])).toBe('Roads copy');
    expect(copyName('Roads', ['Roads', 'Roads copy'])).toBe('Roads copy 2');
    expect(copyName('Roads copy', ['Roads copy'])).toBe('Roads copy 2');
  });
});
