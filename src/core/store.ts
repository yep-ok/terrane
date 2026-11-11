// Project store (zustand + immer): maps, layers, layouts, charts.
// Mutate ONLY through the exported action functions below.
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type {
  Bookmark, ChartDoc, Dataset, FeatureLayer, GeomType, GroupLayer, Id, LabelDef, Layer, LayoutDoc, MapDoc, Project,
  ProjectFile, SymbolDef, ViewState,
} from './types';
import { allDatasets, clearDatasets, getDataset, registerDataset, uid } from './data';
import { clearHistory } from './history';

interface ProjectState {
  project: Project;
  /** True when there are unsaved changes (set by persistence code). */
  dirty: boolean;
}

function emptyProject(name = 'Untitled'): Project {
  return { version: 1, name, maps: [], layouts: [], charts: [] };
}

export const useProject = create<ProjectState>()(immer(() => ({ project: emptyProject(), dirty: false })));

const set = (fn: (p: Project) => void) =>
  useProject.setState((s) => {
    fn(s.project);
    s.dirty = true;
  });
export const getProject = () => useProject.getState().project;

// ---------- defaults ----------

const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#b07aa1', '#76b7b2', '#edc948', '#ff9da7', '#9c755f', '#86bcb6'];
let paletteIndex = 0;
export const nextColor = () => PALETTE[paletteIndex++ % PALETTE.length];

export function defaultSymbol(geomType: GeomType | null, color = nextColor()): SymbolDef {
  if (geomType === 'Polygon')
    return { fill: color, fillOpacity: 0.55, stroke: '#3b3b3b', strokeWidth: 0.8, size: 6, shape: 'circle' };
  if (geomType === 'LineString')
    return { fill: color, fillOpacity: 1, stroke: color, strokeWidth: 1.8, size: 6, shape: 'circle' };
  return { fill: color, fillOpacity: 1, stroke: '#ffffff', strokeWidth: 1, size: 5, shape: 'circle' };
}

export function defaultLabels(ds?: Dataset): LabelDef {
  const nameField =
    ds?.fields.find((f) => /^(name|title|label)$/i.test(f.name)) ??
    ds?.fields.find((f) => /name/i.test(f.name)) ??
    ds?.fields.find((f) => f.type === 'string') ??
    ds?.fields[0];
  return {
    enabled: false,
    expression: nameField ? fieldRef(nameField.name) : '',
    fontSize: 12,
    color: '#1b1b1b',
    haloColor: '#ffffff',
    haloWidth: 2,
  };
}

/** How a field is referenced inside an expression. */
export function fieldRef(name: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `[${name}]`;
}

export function makeFeatureLayer(ds: Dataset, patch: Partial<FeatureLayer> = {}): FeatureLayer {
  return {
    id: uid('lyr'),
    kind: 'feature',
    name: ds.name,
    visible: true,
    opacity: 1,
    datasetId: ds.id,
    renderer: { type: 'single', symbol: defaultSymbol(ds.geomType) },
    labels: defaultLabels(ds),
    selectable: true,
    editable: true,
    ...patch,
  };
}

export function makeGroupLayer(name = 'New Group Layer'): GroupLayer {
  return { id: uid('grp'), kind: 'group', name, visible: true, opacity: 1, expanded: true };
}

// ---------- project lifecycle ----------

export function newProject(name = 'Untitled') {
  clearDatasets();
  clearHistory();
  useProject.setState({ project: emptyProject(name), dirty: false });
}

export function toProjectFile(): ProjectFile {
  return { format: 'terrane-project', project: getProject(), datasets: allDatasets() };
}

export function loadProjectFile(file: ProjectFile) {
  if (file?.format !== 'terrane-project') throw new Error('Not a Terrane project file');
  clearDatasets();
  clearHistory();
  for (const ds of file.datasets) registerDataset(ds);
  useProject.setState({
    project: { ...emptyProject(), ...file.project, charts: file.project.charts ?? [], layouts: file.project.layouts ?? [] },
    dirty: false,
  });
}

export const renameProject = (name: string) => set((p) => void (p.name = name));
export const markSaved = () => useProject.setState({ dirty: false });

// ---------- maps ----------

function uniqueName(base: string, taken: string[]) {
  if (!taken.includes(base)) return base;
  for (let i = 1; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

export function addMap(patch: Partial<MapDoc> = {}): MapDoc {
  const map: MapDoc = {
    id: uid('map'),
    name: uniqueName('Map', getProject().maps.map((m) => m.name)),
    layers: [],
    basemap: 'osm',
    crs: 'EPSG:3857',
    view: { center: [0, 20], zoom: 2.2, rotation: 0 },
    bookmarks: [],
    ...patch,
  };
  set((p) => void p.maps.push(map));
  return map;
}
export const removeMap = (id: Id) =>
  set((p) => {
    p.maps = p.maps.filter((m) => m.id !== id);
    p.charts = p.charts.filter((c) => c.mapId !== id);
  });
export const updateMap = (id: Id, patch: Partial<Omit<MapDoc, 'id' | 'layers'>>) =>
  set((p) => {
    const m = p.maps.find((x) => x.id === id);
    if (m) Object.assign(m, patch);
  });
export const getMap = (id: Id | null | undefined): MapDoc | undefined => getProject().maps.find((m) => m.id === id);

/** View changes do not mark the project dirty-worthy of undo; called on every map moveend. */
export const setView = (mapId: Id, view: ViewState) =>
  useProject.setState((s) => {
    const m = s.project.maps.find((x) => x.id === mapId);
    if (m) m.view = view;
  });

export function addBookmark(mapId: Id, name: string, view?: ViewState): Bookmark | undefined {
  const m = getMap(mapId);
  if (!m) return;
  const bm: Bookmark = { id: uid('bm'), name, ...(view ?? m.view) };
  set((p) => void p.maps.find((x) => x.id === mapId)?.bookmarks.push(bm));
  return bm;
}
export const removeBookmark = (mapId: Id, id: Id) =>
  set((p) => {
    const m = p.maps.find((x) => x.id === mapId);
    if (m) m.bookmarks = m.bookmarks.filter((b) => b.id !== id);
  });
export const renameBookmark = (mapId: Id, id: Id, name: string) =>
  set((p) => {
    const b = p.maps.find((x) => x.id === mapId)?.bookmarks.find((x) => x.id === id);
    if (b) b.name = name;
  });

// ---------- layers ----------

/** Find a layer anywhere in the project (layer ids are globally unique). */
export function findLayer(layerId: Id | null | undefined): { map: MapDoc; layer: Layer; index: number } | undefined {
  if (!layerId) return;
  for (const map of getProject().maps) {
    const index = map.layers.findIndex((l) => l.id === layerId);
    if (index >= 0) return { map, layer: map.layers[index], index };
  }
}
export function findFeatureLayer(layerId: Id | null | undefined): { map: MapDoc; layer: FeatureLayer; dataset: Dataset } | undefined {
  const hit = findLayer(layerId);
  if (!hit || hit.layer.kind !== 'feature') return;
  const dataset = getDataset(hit.layer.datasetId);
  return dataset ? { map: hit.map, layer: hit.layer, dataset } : undefined;
}

/** Insert a layer; index 0 = top of Contents. */
export function addLayer<T extends Layer>(mapId: Id, layer: T, index = 0): T {
  set((p) => {
    const m = p.maps.find((x) => x.id === mapId);
    if (m) m.layers.splice(Math.max(0, Math.min(index, m.layers.length)), 0, layer as any);
  });
  return layer;
}

/** Add a dataset to a map as a new feature layer (points above lines above polygons). */
export function addDatasetLayer(mapId: Id, ds: Dataset, patch: Partial<FeatureLayer> = {}): FeatureLayer {
  const layer = makeFeatureLayer(ds, patch);
  const map = getMap(mapId);
  let index = 0;
  if (map && ds.geomType !== 'Point') {
    const rank = (l: Layer) => {
      if (l.kind !== 'feature') return 3;
      const g = getDataset(l.datasetId)?.geomType;
      return g === 'Point' ? 0 : g === 'LineString' ? 1 : 2;
    };
    const mine = ds.geomType === 'LineString' ? 1 : 2;
    while (index < map.layers.length && !map.layers[index].parentId && rank(map.layers[index]) < mine) index++;
  }
  return addLayer(mapId, layer, index);
}

/** Remove a layer (and, for groups, its children). Does not delete the dataset. */
export const removeLayer = (layerId: Id) =>
  set((p) => {
    for (const m of p.maps) {
      const doomed = new Set<Id>([layerId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const l of m.layers)
          if (l.parentId && doomed.has(l.parentId) && !doomed.has(l.id)) {
            doomed.add(l.id);
            grew = true;
          }
      }
      if (m.layers.some((l) => l.id === layerId)) m.layers = m.layers.filter((l) => !doomed.has(l.id));
    }
    p.charts = p.charts.filter((c) => c.layerId !== layerId);
  });

/** Shallow-merge a patch into a layer. Replace nested objects (renderer, labels) wholesale. */
export function updateLayer<T extends Layer = Layer>(layerId: Id, patch: Partial<T>) {
  set((p) => {
    for (const m of p.maps) {
      const l = m.layers.find((x) => x.id === layerId);
      if (l) Object.assign(l, patch);
    }
  });
}

/** Move a layer to a new index in its map's flat list, optionally re-parenting it. */
export const moveLayer = (layerId: Id, toIndex: number, parentId?: Id | null) =>
  set((p) => {
    for (const m of p.maps) {
      const from = m.layers.findIndex((l) => l.id === layerId);
      if (from < 0) continue;
      const [l] = m.layers.splice(from, 1);
      if (parentId !== undefined) l.parentId = parentId;
      m.layers.splice(Math.max(0, Math.min(from < toIndex ? toIndex - 1 : toIndex, m.layers.length)), 0, l);
    }
  });

/** A layer is effectively visible only if it and all its ancestor groups are visible. */
export function isLayerVisible(map: MapDoc, layer: Layer): boolean {
  let cur: Layer | undefined = layer;
  for (let guard = 0; cur && guard < 20; guard++) {
    if (!cur.visible) return false;
    const pid: Id | null | undefined = cur.parentId;
    cur = pid ? map.layers.find((l) => l.id === pid) : undefined;
  }
  return true;
}

// ---------- layouts & charts ----------

export function addLayout(patch: Partial<LayoutDoc> = {}): LayoutDoc {
  const layout: LayoutDoc = {
    id: uid('lay'),
    name: uniqueName('Layout', getProject().layouts.map((l) => l.name)),
    page: { width: 297, height: 210 },
    elements: [],
    ...patch,
  };
  set((p) => void p.layouts.push(layout));
  return layout;
}
export const updateLayout = (id: Id, fn: (l: LayoutDoc) => void) =>
  set((p) => {
    const l = p.layouts.find((x) => x.id === id);
    if (l) fn(l);
  });
export const removeLayout = (id: Id) => set((p) => void (p.layouts = p.layouts.filter((l) => l.id !== id)));
export const getLayout = (id: Id | null | undefined) => getProject().layouts.find((l) => l.id === id);

export function addChart(chart: Omit<ChartDoc, 'id'>): ChartDoc {
  const c: ChartDoc = { ...chart, id: uid('chart') };
  set((p) => void p.charts.push(c));
  return c;
}
export const updateChart = (id: Id, fn: (c: ChartDoc) => void) =>
  set((p) => {
    const c = p.charts.find((x) => x.id === id);
    if (c) fn(c);
  });
export const removeChart = (id: Id) => set((p) => void (p.charts = p.charts.filter((c) => c.id !== id)));

// ---------- hooks ----------

export const useMapDoc = (id: Id | null | undefined) => useProject((s) => s.project.maps.find((m) => m.id === id));
export const useLayer = (layerId: Id | null | undefined) =>
  useProject((s) => {
    if (!layerId) return undefined;
    for (const m of s.project.maps) {
      const l = m.layers.find((x) => x.id === layerId);
      if (l) return l;
    }
    return undefined;
  });
export const useLayoutDoc = (id: Id | null | undefined) => useProject((s) => s.project.layouts.find((l) => l.id === id));
