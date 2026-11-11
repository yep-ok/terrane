// UI/session state: open views, panes, active tool, selection, dialogs, toasts.
import type { ReactNode } from 'react';
import { create } from 'zustand';
import type { Id } from './types';
import { uid } from './data';
import { findLayer, getProject } from './store';

export type ViewType = 'map' | 'layout' | 'chart';
export interface ViewTab {
  id: Id;
  type: ViewType;
  refId: Id; // MapDoc / LayoutDoc / ChartDoc id
}
export type DockSide = 'left' | 'right' | 'bottom';
export interface DockState {
  panes: string[]; // pane ids in tab order
  active: string | null;
  size: number; // px
}
export interface Toast {
  id: Id;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}
export type MenuItem =
  | 'separator'
  | { label: string; icon?: ReactNode; onClick?: () => void; disabled?: boolean; checked?: boolean; danger?: boolean; submenu?: MenuItem[] };
export type SelectMode = 'new' | 'add' | 'remove' | 'toggle';

interface UiState {
  views: ViewTab[];
  activeViewId: Id | null;
  /** Most recently active map (stays set while a layout/chart view is in front). */
  activeMapId: Id | null;
  /** Layer highlighted in Contents; drives the contextual Feature Layer ribbon tab. */
  activeLayerId: Id | null;
  /** layerId -> selected feature ids. */
  selection: Record<Id, number[]>;
  /** Active map tool id (see registerMapTool). */
  activeTool: string;
  ribbonTab: string;
  ribbonCollapsed: boolean;
  docks: Record<DockSide, DockState>;
  paneProps: Record<string, any>;
  /** Layer ids with an open attribute table (bottom dock), and the one in front. */
  openTables: Id[];
  activeTable: Id | null;
  dialogs: Array<{ key: Id; id: string; props: any }>;
  toasts: Toast[];
  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  theme: 'dark' | 'light';
  cursor: { lon: number; lat: number } | null;
  scale: number | null;
  busy: string | null;
}

export const useUi = create<UiState>()(() => ({
  views: [],
  activeViewId: null,
  activeMapId: null,
  activeLayerId: null,
  selection: {},
  activeTool: 'explore',
  ribbonTab: 'map',
  ribbonCollapsed: false,
  docks: {
    left: { panes: [], active: null, size: 290 },
    right: { panes: [], active: null, size: 340 },
    bottom: { panes: [], active: null, size: 260 },
  },
  paneProps: {},
  openTables: [],
  activeTable: null,
  dialogs: [],
  toasts: [],
  contextMenu: null,
  theme: (typeof localStorage !== 'undefined' && (localStorage.getItem('terrane.theme') as any)) || 'dark',
  cursor: null,
  scale: null,
  busy: null,
}));

const set = useUi.setState;
const get = useUi.getState;

// ---------- views ----------

export function openView(type: ViewType, refId: Id) {
  const existing = get().views.find((v) => v.type === type && v.refId === refId);
  if (existing) return activateView(existing.id);
  const view: ViewTab = { id: uid('view'), type, refId };
  set((s) => ({ views: [...s.views, view] }));
  activateView(view.id);
}
export function activateView(id: Id) {
  const v = get().views.find((x) => x.id === id);
  if (!v) return;
  set((s) => ({
    activeViewId: id,
    activeMapId: v.type === 'map' ? v.refId : s.activeMapId,
    ribbonTab: v.type === 'layout' ? 'layout' : s.ribbonTab === 'layout' ? 'map' : s.ribbonTab,
  }));
}
export function closeView(id: Id) {
  set((s) => {
    const views = s.views.filter((v) => v.id !== id);
    let activeViewId = s.activeViewId;
    if (activeViewId === id) activeViewId = views[views.length - 1]?.id ?? null;
    const maps = views.filter((v) => v.type === 'map');
    const activeMapId = maps.some((v) => v.refId === s.activeMapId) ? s.activeMapId : maps[maps.length - 1]?.refId ?? null;
    return { views, activeViewId, activeMapId };
  });
  const a = get().activeViewId;
  if (a) activateView(a);
}
/** Close views whose document no longer exists. */
export function pruneViews() {
  const p = getProject();
  for (const v of get().views) {
    const ok =
      v.type === 'map' ? p.maps.some((m) => m.id === v.refId)
      : v.type === 'layout' ? p.layouts.some((l) => l.id === v.refId)
      : p.charts.some((c) => c.id === v.refId);
    if (!ok) closeView(v.id);
  }
}
export const activeView = () => get().views.find((v) => v.id === get().activeViewId);
export const activeMapId = () => get().activeMapId;
export const useActiveMapId = () => useUi((s) => s.activeMapId);
export const useActiveView = () => useUi((s) => s.views.find((v) => v.id === s.activeViewId));

// ---------- active layer & selection ----------

export const setActiveLayer = (layerId: Id | null) => set({ activeLayerId: layerId });
export const activeLayerId = () => get().activeLayerId;
export const useActiveLayerId = () => useUi((s) => s.activeLayerId);

const EMPTY: number[] = [];
export function setSelection(layerId: Id, ids: number[], mode: SelectMode = 'new') {
  set((s) => {
    const cur = s.selection[layerId] ?? EMPTY;
    let next: number[];
    if (mode === 'new') next = ids;
    else if (mode === 'add') next = [...new Set([...cur, ...ids])];
    else if (mode === 'remove') {
      const rm = new Set(ids);
      next = cur.filter((i) => !rm.has(i));
    } else {
      const c = new Set(cur);
      for (const i of ids) c.has(i) ? c.delete(i) : c.add(i);
      next = [...c];
    }
    const selection = { ...s.selection };
    if (next.length) selection[layerId] = next;
    else delete selection[layerId];
    return { selection };
  });
}
/** Clear the selection of one layer, or of every layer when omitted. */
export function clearSelection(layerId?: Id) {
  set((s) => {
    if (!layerId) return { selection: {} };
    const selection = { ...s.selection };
    delete selection[layerId];
    return { selection };
  });
}
export const getSelection = (layerId: Id): number[] => get().selection[layerId] ?? EMPTY;
export const useSelection = (layerId: Id | null | undefined): number[] => useUi((s) => (layerId ? s.selection[layerId] ?? EMPTY : EMPTY));
export const totalSelected = () => Object.values(get().selection).reduce((n, a) => n + a.length, 0);

// ---------- tools ----------

export const setTool = (id: string) => set({ activeTool: id });
export const useActiveTool = () => useUi((s) => s.activeTool);

// ---------- panes ----------

/** Dock assignment is taken from the pane registration; see registry.ts openPane(). */
export function showPaneIn(side: DockSide, paneId: string, props?: any) {
  set((s) => {
    const d = s.docks[side];
    const panes = d.panes.includes(paneId) ? d.panes : [...d.panes, paneId];
    return {
      docks: { ...s.docks, [side]: { ...d, panes, active: paneId } },
      paneProps: props === undefined ? s.paneProps : { ...s.paneProps, [paneId]: props },
    };
  });
}
export function hidePane(paneId: string) {
  set((s) => {
    const docks = { ...s.docks };
    for (const side of ['left', 'right', 'bottom'] as DockSide[]) {
      const d = docks[side];
      if (!d.panes.includes(paneId)) continue;
      const panes = d.panes.filter((p) => p !== paneId);
      docks[side] = { ...d, panes, active: d.active === paneId ? panes[panes.length - 1] ?? null : d.active };
    }
    return { docks };
  });
}
export const isPaneOpen = (paneId: string) => Object.values(get().docks).some((d) => d.panes.includes(paneId));
export const setDockSize = (side: DockSide, size: number) =>
  set((s) => ({ docks: { ...s.docks, [side]: { ...s.docks[side], size } } }));
export const usePaneProps = <T = any>(paneId: string): T | undefined => useUi((s) => s.paneProps[paneId]);

// ---------- attribute tables (bottom dock pane 'table') ----------

export function openTable(layerId: Id) {
  set((s) => ({ openTables: s.openTables.includes(layerId) ? s.openTables : [...s.openTables, layerId], activeTable: layerId }));
  showPaneIn('bottom', 'table');
}
export function closeTable(layerId: Id) {
  set((s) => {
    const openTables = s.openTables.filter((l) => l !== layerId);
    return { openTables, activeTable: s.activeTable === layerId ? openTables[openTables.length - 1] ?? null : s.activeTable };
  });
  if (!get().openTables.length) hidePane('table');
}

// ---------- dialogs, toasts, menus ----------

export function openDialog(id: string, props: any = {}) {
  set((s) => ({ dialogs: [...s.dialogs, { key: uid('dlg'), id, props }] }));
}
export const closeDialog = (key: Id) => set((s) => ({ dialogs: s.dialogs.filter((d) => d.key !== key) }));

export function notify(message: string, type: Toast['type'] = 'info', ms = type === 'error' ? 8000 : 4000) {
  const id = uid('toast');
  set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
  setTimeout(() => dismissToast(id), ms);
}
export const dismissToast = (id: Id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

export const showContextMenu = (e: { clientX: number; clientY: number; preventDefault?: () => void }, items: MenuItem[]) => {
  e.preventDefault?.();
  set({ contextMenu: { x: e.clientX, y: e.clientY, items } });
};
export const hideContextMenu = () => set({ contextMenu: null });

export function setTheme(theme: 'dark' | 'light') {
  try {
    localStorage.setItem('terrane.theme', theme);
  } catch {}
  document.documentElement.dataset.theme = theme;
  set({ theme });
}
export const setBusy = (label: string | null) => set({ busy: label });
export const setRibbonTab = (id: string) => set({ ribbonTab: id, ribbonCollapsed: false });

/** Drop session state that refers to layers that no longer exist. Called when the project changes. */
export function pruneLayerState() {
  const s = get();
  const alive = (id: Id) => !!findLayer(id);
  const selection: Record<Id, number[]> = {};
  let changed = false;
  for (const k in s.selection) alive(k) ? (selection[k] = s.selection[k]) : (changed = true);
  const openTables = s.openTables.filter(alive);
  if (openTables.length !== s.openTables.length) changed = true;
  const activeLayerId = s.activeLayerId && alive(s.activeLayerId) ? s.activeLayerId : null;
  if (activeLayerId !== s.activeLayerId) changed = true;
  if (changed)
    set({ selection, openTables, activeLayerId, activeTable: s.activeTable && openTables.includes(s.activeTable) ? s.activeTable : openTables[0] ?? null });
}

export function resetSession() {
  set({ views: [], activeViewId: null, activeMapId: null, activeLayerId: null, selection: {}, openTables: [], activeTable: null, activeTool: 'explore' });
}
