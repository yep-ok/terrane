// Local UI state of the Contents pane (survives the pane being hidden and re-shown).
import { create } from 'zustand';
import type { Id } from '../../core/types';
import type { DropZone } from './tree';

export type ContentsMode = 'order' | 'source' | 'selection' | 'editing';

interface ContentsState {
  mode: ContentsMode;
  /** Layers whose legend is collapsed. */
  collapsedLegends: Record<Id, true>;
  /** Layers multi-selected with Ctrl/Shift (always includes the active layer when non-empty). */
  multi: Id[];
  anchor: Id | null;
  renamingId: Id | null;
  renamingMap: boolean;
  dragId: Id | null;
  drop: { targetId: Id | null; zone: DropZone } | null;
}

export const useContentsUi = create<ContentsState>()(() => ({
  mode: 'order',
  collapsedLegends: {},
  multi: [],
  anchor: null,
  renamingId: null,
  renamingMap: false,
  dragId: null,
  drop: null,
}));

export const cui = useContentsUi.setState;
export const cuiGet = useContentsUi.getState;

/** Ids of the rows currently displayed, top to bottom (written by the pane, read by range selection). */
export const rowOrder: { ids: Id[] } = { ids: [] };

export function toggleLegend(id: Id) {
  cui((s) => {
    const next = { ...s.collapsedLegends };
    if (next[id]) delete next[id];
    else next[id] = true;
    return { collapsedLegends: next };
  });
}

export const startRename = (id: Id) => cui({ renamingId: id, renamingMap: false });
export const stopRename = () => cui({ renamingId: null, renamingMap: false });
