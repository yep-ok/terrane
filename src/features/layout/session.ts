// Layout session state (zoom, pan, selection, toggles) and undoable edit helpers.
import { create } from 'zustand';
import type { Id, LayoutDoc, LayoutElement } from '../../core/types';
import { getLayout, updateLayout, useProject } from '../../core/store';
import { useUi } from '../../core/ui';
import { pushUndo, subscribeHistory, type UndoEntry } from '../../core/history';

export interface LayoutViewState {
  zoom: number; // screen px per mm
  panX: number; // page origin offset inside the viewport (px)
  panY: number;
  selection: Id[];
  /** Map frame currently activated for panning/zooming its map. */
  activeFrame: Id | null;
  /** Text element being edited inline. */
  editingText: Id | null;
  viewport: { width: number; height: number };
  /** True once the view has fitted the page at least once. */
  fitted: boolean;
}

interface Session {
  views: Record<Id, LayoutViewState>;
  rulers: boolean;
  guides: boolean;
  grid: boolean;
  snap: boolean;
  gridSize: number; // mm
}

const blank = (): LayoutViewState => ({
  zoom: 2, panX: 40, panY: 40, selection: [], activeFrame: null, editingText: null, viewport: { width: 800, height: 600 }, fitted: false,
});

const load = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem('terrane.layout.' + key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};

export const useLayoutSession = create<Session>()(() => ({
  views: {},
  rulers: load('rulers', true),
  guides: load('guides', true),
  grid: load('grid', false),
  snap: load('snap', true),
  gridSize: load('gridSize', 5),
}));

export function setSessionFlag(key: 'rulers' | 'guides' | 'grid' | 'snap' | 'gridSize', value: boolean | number) {
  useLayoutSession.setState({ [key]: value } as any);
  try {
    localStorage.setItem('terrane.layout.' + key, JSON.stringify(value));
  } catch {}
}

const BLANK = blank();
export const getViewState = (layoutId: Id): LayoutViewState => useLayoutSession.getState().views[layoutId] ?? BLANK;
export function setViewState(layoutId: Id, patch: Partial<LayoutViewState>) {
  useLayoutSession.setState((s) => ({ views: { ...s.views, [layoutId]: { ...(s.views[layoutId] ?? blank()), ...patch } } }));
}
export const useViewState = <T,>(layoutId: Id, sel: (v: LayoutViewState) => T) => useLayoutSession((s) => sel(s.views[layoutId] ?? BLANK));

const NONE: Id[] = [];
export const useLayoutSelection = (layoutId: Id | null | undefined) =>
  useLayoutSession((s) => (layoutId ? s.views[layoutId]?.selection ?? NONE : NONE));
export const getSelectionIds = (layoutId: Id) => getViewState(layoutId).selection;
export const setSelectionIds = (layoutId: Id, ids: Id[]) => setViewState(layoutId, { selection: ids });

/** Layout of the active center view, if it is a layout view. */
export function activeLayoutId(): Id | null {
  const s = useUi.getState();
  const v = s.views.find((x) => x.id === s.activeViewId);
  return v?.type === 'layout' ? v.refId : null;
}
export const useActiveLayoutId = () =>
  useUi((s) => {
    const v = s.views.find((x) => x.id === s.activeViewId);
    return v?.type === 'layout' ? v.refId : null;
  });
export const activeLayout = (): LayoutDoc | undefined => getLayout(activeLayoutId());

export function selectedElements(layoutId: Id): LayoutElement[] {
  const l = getLayout(layoutId);
  const sel = new Set(getSelectionIds(layoutId));
  return l ? l.elements.filter((e) => sel.has(e.id)) : [];
}

/** Drop selection ids that no longer exist (after undo/delete). */
useProject.subscribe((s, prev) => {
  if (s.project.layouts === prev.project.layouts) return;
  const views = useLayoutSession.getState().views;
  let changed = false;
  const next: Record<Id, LayoutViewState> = {};
  for (const id in views) {
    const l = s.project.layouts.find((x) => x.id === id);
    const v = views[id];
    const alive = new Set(l?.elements.map((e) => e.id) ?? []);
    const selection = v.selection.filter((e) => alive.has(e));
    const activeFrame = v.activeFrame && alive.has(v.activeFrame) ? v.activeFrame : null;
    const editingText = v.editingText && alive.has(v.editingText) ? v.editingText : null;
    if (selection.length !== v.selection.length || activeFrame !== v.activeFrame || editingText !== v.editingText) {
      changed = true;
      next[id] = { ...v, selection, activeFrame, editingText };
    } else next[id] = v;
  }
  if (changed) useLayoutSession.setState({ views: next });
});

// ---------- undoable edits ----------

function restore(id: Id, snap: LayoutDoc) {
  updateLayout(id, (l) => {
    for (const k of Object.keys(l) as Array<keyof LayoutDoc>) if (!(k in snap)) delete (l as any)[k];
    Object.assign(l, snap);
  });
}

let pushingOwn = false;
let lastEntry: { entry: UndoEntry; key: string; at: number; state: { after: LayoutDoc } } | null = null;
subscribeHistory(() => {
  if (!pushingOwn) lastEntry = null;
});

/**
 * Apply an undoable change to a layout. Successive edits with the same `coalesce` key within
 * 1.2 s merge into one undo step (typing in a numeric field, repeated nudges).
 */
export function editLayout(layoutId: Id, label: string, fn: (l: LayoutDoc) => void, coalesce?: string) {
  const before = getLayout(layoutId);
  if (!before) return;
  updateLayout(layoutId, fn);
  const after = getLayout(layoutId);
  if (!after || after === before) return;
  const now = Date.now();
  const key = coalesce ? layoutId + '|' + coalesce : '';
  if (key && lastEntry && lastEntry.key === key && now - lastEntry.at < 1200) {
    lastEntry.state.after = after;
    lastEntry.at = now;
    return;
  }
  recordUndo(layoutId, label, before, after, key);
}

/** Push an undo entry for a change already applied (before -> after snapshots). */
export function recordUndo(layoutId: Id, label: string, before: LayoutDoc, after: LayoutDoc, key = '') {
  if (before === after) return;
  const state = { after };
  const entry: UndoEntry = {
    label,
    undo: () => restore(layoutId, before),
    redo: () => restore(layoutId, state.after),
  };
  pushingOwn = true;
  try {
    pushUndo(entry);
  } finally {
    pushingOwn = false;
  }
  lastEntry = key ? { entry, key, at: Date.now(), state } : null;
}

/** Patch elements by id (shallow; props merged one level deep). */
export function patchElements(layoutId: Id, label: string, patches: Record<Id, Partial<Omit<LayoutElement, 'props'>> & { props?: Record<string, any> }>, coalesce?: string) {
  editLayout(
    layoutId,
    label,
    (l) => {
      for (const el of l.elements) {
        const p = patches[el.id];
        if (!p) continue;
        const { props, ...rest } = p;
        Object.assign(el, rest);
        if (props) el.props = { ...el.props, ...props };
      }
    },
    coalesce,
  );
}

export const patchElement = (layoutId: Id, id: Id, patch: Partial<Omit<LayoutElement, 'props'>> & { props?: Record<string, any> }, label = 'Edit Element', coalesce?: string) =>
  patchElements(layoutId, label, { [id]: patch }, coalesce ?? id + '|' + Object.keys(patch).join(',') + Object.keys(patch.props ?? {}).join(','));

export const patchProps = (layoutId: Id, id: Id, props: Record<string, any>, label = 'Edit Element') => patchElement(layoutId, id, { props }, label);
