// Editing session state: current template + construction tool, snapping settings
// (persisted), attribute auto-apply, and the feature clipboard.
import { create } from 'zustand';
import type { Geometry } from 'geojson';
import type { Id } from '../../core/types';
import type { Family } from './geom';

export type Construction = 'point' | 'line' | 'freehand-line' | 'polygon' | 'freehand-polygon' | 'rectangle' | 'circle' | 'ngon';

export interface Template {
  /** Stable key: layerId or layerId + class value. */
  key: string;
  layerId: Id;
  label: string;
  /** Attribute values applied to new features. */
  presets: Record<string, any>;
}

export interface ClipboardItem {
  geometry: Geometry;
  properties: Record<string, any>;
}
export interface Clipboard {
  family: Family;
  sourceLayerId: Id;
  items: ClipboardItem[];
}

interface EditState {
  template: Template | null;
  construction: Construction;
  ngonSides: number;
  snapping: boolean;
  snapTolerance: number;
  autoApply: boolean;
  clipboard: Clipboard | null;
}

const KEY = 'terrane.edit.settings';
function load(): Partial<EditState> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
const saved = load();

export const useEdit = create<EditState>()(() => ({
  template: null,
  construction: 'polygon',
  ngonSides: Number.isInteger(saved.ngonSides) && saved.ngonSides! >= 3 ? saved.ngonSides! : 6,
  snapping: saved.snapping ?? true,
  snapTolerance: typeof saved.snapTolerance === 'number' ? saved.snapTolerance : 10,
  autoApply: saved.autoApply ?? false,
  clipboard: null,
}));

useEdit.subscribe((s, prev) => {
  if (s.snapping === prev.snapping && s.snapTolerance === prev.snapTolerance && s.autoApply === prev.autoApply && s.ngonSides === prev.ngonSides) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ snapping: s.snapping, snapTolerance: s.snapTolerance, autoApply: s.autoApply, ngonSides: s.ngonSides }));
  } catch {}
});

export const CONSTRUCTIONS: Record<Family, Construction[]> = {
  Point: ['point'],
  LineString: ['line', 'freehand-line'],
  Polygon: ['polygon', 'freehand-polygon', 'rectangle', 'circle', 'ngon'],
};

export const CONSTRUCTION_LABEL: Record<Construction, string> = {
  point: 'Point',
  line: 'Line',
  'freehand-line': 'Freehand line',
  polygon: 'Polygon',
  'freehand-polygon': 'Freehand polygon',
  rectangle: 'Rectangle',
  circle: 'Circle',
  ngon: 'Regular polygon',
};

export function setTemplate(template: Template | null, family?: Family | null) {
  const cur = useEdit.getState().construction;
  const valid = family ? CONSTRUCTIONS[family] : null;
  useEdit.setState({ template, construction: valid && !valid.includes(cur) ? valid[0] : cur });
}
export const setConstruction = (construction: Construction) => useEdit.setState({ construction });
