// Per-layer table view state (sort, widths, hidden columns, filters). Lives
// outside React so it survives switching tabs and closing the pane.
import { create } from 'zustand';
import type { Id } from '../../core/types';
import type { SortSpec } from './logic';

export interface LayerTableState {
  sort: SortSpec | null;
  widths: Record<string, number>;
  hidden: string[];
  selOnly: boolean;
  search: string;
}

const DEFAULT: LayerTableState = { sort: null, widths: {}, hidden: [], selOnly: false, search: '' };

export const useTableUi = create<{ byLayer: Record<Id, LayerTableState> }>()(() => ({ byLayer: {} }));

export const getTableState = (layerId: Id): LayerTableState => useTableUi.getState().byLayer[layerId] ?? DEFAULT;

export function patchTable(layerId: Id, patch: Partial<LayerTableState>) {
  useTableUi.setState((s) => ({ byLayer: { ...s.byLayer, [layerId]: { ...(s.byLayer[layerId] ?? DEFAULT), ...patch } } }));
}

export const useLayerTable = (layerId: Id): LayerTableState => useTableUi((s) => s.byLayer[layerId] ?? DEFAULT);
