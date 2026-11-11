// DataStore: datasets live outside React state (they can be large). Components
// subscribe with useDataset(); everything else uses subscribeData().
import { useSyncExternalStore } from 'react';
import type { Feature, Geometry, Position } from 'geojson';
import type { Dataset, Extent, Feat, Field, FieldType, GeomType, Id } from './types';
import { bboxClip } from '@turf/turf';
import { pushUndo, transaction, withoutHistory } from './history';

export type DataEvent =
  | { datasetId: Id; type: 'add' | 'remove' | 'reset' | 'schema' }
  | { datasetId: Id; type: 'edit'; adds: number[]; updates: number[]; deletes: number[] };

const datasets = new Map<Id, Dataset>();
const versions = new Map<Id, number>();
const indexes = new Map<Id, Map<number, Feat>>();
const listeners = new Set<(e: DataEvent) => void>();
let globalVersion = 0;

let uidCounter = 0;
export function uid(prefix = 'id'): Id {
  uidCounter++;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function emit(e: DataEvent) {
  versions.set(e.datasetId, (versions.get(e.datasetId) ?? 0) + 1);
  globalVersion++;
  indexes.delete(e.datasetId);
  listeners.forEach((l) => l(e));
}

export function subscribeData(cb: (e: DataEvent) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------- geometry helpers ----------

export function geomTypeOf(g: Geometry | null | undefined): GeomType | null {
  if (!g) return null;
  switch (g.type) {
    case 'Point':
    case 'MultiPoint':
      return 'Point';
    case 'LineString':
    case 'MultiLineString':
      return 'LineString';
    case 'Polygon':
    case 'MultiPolygon':
      return 'Polygon';
    case 'GeometryCollection':
      return g.geometries.length ? geomTypeOf(g.geometries[0]) : null;
  }
}

export function eachCoord(g: Geometry | null | undefined, cb: (p: Position) => void) {
  if (!g) return;
  if (g.type === 'GeometryCollection') {
    g.geometries.forEach((x) => eachCoord(x, cb));
    return;
  }
  const walk = (c: any) => {
    if (typeof c[0] === 'number') cb(c);
    else for (const x of c) walk(x);
  };
  walk(g.coordinates);
}

export function geometryExtent(g: Geometry | null | undefined, into?: Extent): Extent | null {
  const e: Extent = into ?? [Infinity, Infinity, -Infinity, -Infinity];
  eachCoord(g, (p) => {
    if (p[0] < e[0]) e[0] = p[0];
    if (p[1] < e[1]) e[1] = p[1];
    if (p[0] > e[2]) e[2] = p[0];
    if (p[1] > e[3]) e[3] = p[1];
  });
  return e[0] === Infinity ? null : e;
}

export function featuresExtent(features: Iterable<{ geometry: Geometry | null }>): Extent | null {
  const e: Extent = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) geometryExtent(f.geometry, e);
  return e[0] === Infinity ? null : e;
}

/**
 * Display helper: make coordinate sequences continuous across the antimeridian.
 * A jump of more than 180° of longitude between consecutive vertices is treated as
 * a wrap, so the shape is drawn the short way round instead of as a band across the
 * map. Returns the same object when nothing needs to change.
 */
export function unwrapGeometry<T extends Geometry | null | undefined>(g: T): T {
  if (!g || g.type === 'Point' || g.type === 'MultiPoint') return g;
  if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => unwrapGeometry(x)) } as T;
  let changed = false;
  const line = (pts: Position[]): Position[] => {
    let offset = 0;
    let out: Position[] | null = null;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i][0] - pts[i - 1][0];
      if (d > 180) offset -= 360;
      else if (d < -180) offset += 360;
      if (offset) {
        out ??= pts.slice(0, i);
        out.push([pts[i][0] + offset, ...pts[i].slice(1)]);
      } else if (out) out.push(pts[i]);
    }
    if (out) changed = true;
    return out ?? pts;
  };
  let coordinates: any;
  if (g.type === 'LineString') coordinates = line(g.coordinates);
  else if (g.type === 'MultiLineString' || g.type === 'Polygon') coordinates = g.coordinates.map(line);
  else coordinates = g.coordinates.map((poly) => poly.map(line));
  return changed ? ({ ...g, coordinates } as T) : g;
}

/**
 * Display helper for projections that cannot draw past ±180° (anything but Mercator /
 * plate carrée): cut shapes that cross the antimeridian into a part on each side.
 * Returns the same object when the shape does not cross.
 */
export function splitAtAntimeridian<T extends Geometry | null | undefined>(g: T): T {
  const u = unwrapGeometry(g);
  if (!u || u.type === 'Point' || u.type === 'MultiPoint' || u.type === 'GeometryCollection') return g;
  const ext = geometryExtent(u);
  if (!ext || (ext[0] >= -180 && ext[2] <= 180)) return g;
  const shift = (geom: any, dx: number): any => {
    const walk = (c: any): any => (typeof c[0] === 'number' ? [c[0] + dx, ...c.slice(1)] : c.map(walk));
    return { ...geom, coordinates: walk(geom.coordinates) };
  };
  const parts: any[] = [];
  const isPoly = u.type === 'Polygon' || u.type === 'MultiPolygon';
  for (const [lo, hi, dx] of [[-540, -180, 360], [-180, 180, 0], [180, 540, -360]] as const) {
    if (ext[2] <= lo || ext[0] >= hi) continue;
    try {
      const clipped = bboxClip(u as any, [lo, -90, hi, 90]).geometry as any;
      if (!clipped?.coordinates?.length) continue;
      const moved = dx ? shift(clipped, dx) : clipped;
      const single = moved.type === 'Polygon' || moved.type === 'LineString';
      for (const c of single ? [moved.coordinates] : moved.coordinates) if (c.length) parts.push(c);
    } catch {}
  }
  if (!parts.length) return g;
  return { type: isPoly ? 'MultiPolygon' : 'MultiLineString', coordinates: parts } as T;
}

/** Split an arbitrary feature list into one list per geometry family (key 'Table' for null geometry). */
export function splitByGeomType(features: Feature[]): Partial<Record<GeomType | 'Table', Feature[]>> {
  const out: Partial<Record<GeomType | 'Table', Feature[]>> = {};
  for (const f of features) {
    const k = geomTypeOf(f.geometry) ?? 'Table';
    (out[k] ??= []).push(f);
  }
  return out;
}

// ---------- schema helpers ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function inferFieldType(values: Iterable<any>): FieldType {
  let type: FieldType | null = null;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    let t: FieldType;
    if (typeof v === 'number') t = Number.isInteger(v) ? 'integer' : 'number';
    else if (typeof v === 'boolean') t = 'boolean';
    else if (v instanceof Date) t = 'date';
    else if (typeof v === 'string' && ISO_DATE.test(v)) t = 'date';
    else t = 'string';
    if (type === null) type = t;
    else if (type !== t) {
      if ((type === 'integer' && t === 'number') || (type === 'number' && t === 'integer')) type = 'number';
      else return 'string';
    }
  }
  return type ?? 'string';
}

export function inferFields(features: Array<{ properties: Record<string, any> | null }>): Field[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    for (const k in f.properties ?? {}) {
      if (!seen.has(k)) {
        seen.add(k);
        names.push(k);
      }
    }
  }
  const sample = features.length > 2000 ? features.slice(0, 2000) : features;
  return names.map((name) => ({ name, type: inferFieldType(sample.map((f) => f.properties?.[name])) }));
}

/** Coerce a raw value to a field type (null for empty/unparseable). */
export function coerce(value: any, type: FieldType): any {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'integer': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    case 'boolean':
      if (typeof value === 'string') return /^(true|1|yes|y)$/i.test(value.trim());
      return !!value;
    case 'date':
      if (value instanceof Date) return value.toISOString();
      return String(value);
    default:
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}

// ---------- dataset lifecycle ----------

export interface NewDataset {
  name: string;
  features: Array<Feature | { geometry: Geometry | null; properties: Record<string, any> | null }>;
  fields?: Field[];
  geomType?: GeomType | null;
  source?: string;
}

/** Create and register a dataset. Feature ids are reassigned 1..n. Geometry must be EPSG:4326. */
export function createDataset(input: NewDataset): Dataset {
  const features: Feat[] = input.features.map((f, i) => ({
    type: 'Feature',
    id: i + 1,
    geometry: f.geometry ?? null,
    properties: { ...(f.properties ?? {}) },
  }));
  let geomType = input.geomType;
  if (geomType === undefined) {
    geomType = null;
    for (const f of features) {
      geomType = geomTypeOf(f.geometry);
      if (geomType) break;
    }
  }
  const ds: Dataset = {
    id: uid('ds'),
    name: input.name,
    geomType,
    fields: input.fields ? input.fields.map((f) => ({ ...f })) : inferFields(features),
    features,
    nextFid: features.length + 1,
    source: input.source,
  };
  datasets.set(ds.id, ds);
  emit({ datasetId: ds.id, type: 'add' });
  return ds;
}

/** Register an already-built dataset (project load). */
export function registerDataset(ds: Dataset) {
  datasets.set(ds.id, ds);
  emit({ datasetId: ds.id, type: 'add' });
}

export function removeDataset(id: Id) {
  if (datasets.delete(id)) emit({ datasetId: id, type: 'remove' });
}

export function clearDatasets() {
  for (const id of [...datasets.keys()]) removeDataset(id);
  blobs.clear();
}

export function renameDataset(id: Id, name: string) {
  const ds = datasets.get(id);
  if (!ds) return;
  ds.name = name;
  emit({ datasetId: id, type: 'schema' });
}

export const getDataset = (id: Id | undefined | null): Dataset | undefined => (id ? datasets.get(id) : undefined);
export const allDatasets = (): Dataset[] => [...datasets.values()];

export function featureById(datasetId: Id, fid: number): Feat | undefined {
  let idx = indexes.get(datasetId);
  if (!idx) {
    const ds = datasets.get(datasetId);
    if (!ds) return undefined;
    idx = new Map(ds.features.map((f) => [f.id, f]));
    indexes.set(datasetId, idx);
  }
  return idx.get(fid);
}

export function datasetExtent(id: Id): Extent | null {
  const ds = datasets.get(id);
  return ds ? featuresExtent(ds.features) : null;
}

// ---------- edits ----------

export interface Edits {
  adds?: Array<{ geometry: Geometry | null; properties?: Record<string, any> | null; id?: number }>;
  /** properties are merged into the existing ones. */
  updates?: Array<{ id: number; geometry?: Geometry | null; properties?: Record<string, any> }>;
  deletes?: number[];
}
export interface EditOptions {
  /** Default true. */
  undoable?: boolean;
  label?: string;
}

/**
 * The one way to change features. Replaces feature objects (never mutates them),
 * emits an 'edit' DataEvent and records an undo entry. Returns ids of added features.
 */
export function applyEdits(datasetId: Id, edits: Edits, opts: EditOptions = {}): number[] {
  const ds = datasets.get(datasetId);
  if (!ds) throw new Error(`Unknown dataset ${datasetId}`);
  const inverse: Required<Edits> = { adds: [], updates: [], deletes: [] };
  const forward: Required<Edits> = { adds: [], updates: edits.updates ?? [], deletes: edits.deletes ?? [] };
  const added: number[] = [];
  const updated: number[] = [];
  const deleted: number[] = [];

  if (edits.deletes?.length) {
    const del = new Set(edits.deletes);
    const keep: Feat[] = [];
    for (const f of ds.features) {
      if (del.has(f.id)) {
        inverse.adds.push({ id: f.id, geometry: f.geometry, properties: f.properties });
        deleted.push(f.id);
      } else keep.push(f);
    }
    ds.features = keep;
  }
  if (edits.updates?.length) {
    const byId = new Map(edits.updates.map((u) => [u.id, u]));
    ds.features = ds.features.map((f) => {
      const u = byId.get(f.id);
      if (!u) return f;
      const inv: { id: number; geometry?: Geometry | null; properties?: Record<string, any> } = { id: f.id };
      const next: Feat = { ...f };
      if (u.geometry !== undefined) {
        inv.geometry = f.geometry;
        next.geometry = u.geometry;
      }
      if (u.properties) {
        inv.properties = {};
        for (const k in u.properties) inv.properties[k] = f.properties[k] ?? null;
        next.properties = { ...f.properties, ...u.properties };
      }
      inverse.updates.push(inv);
      updated.push(f.id);
      return next;
    });
  }
  if (edits.adds?.length) {
    const newFeats: Feat[] = edits.adds.map((a) => {
      const id = a.id ?? ds.nextFid++;
      if (id >= ds.nextFid) ds.nextFid = id + 1;
      added.push(id);
      const props: Record<string, any> = {};
      for (const fld of ds.fields) props[fld.name] = null;
      Object.assign(props, a.properties ?? {});
      forward.adds.push({ id, geometry: a.geometry, properties: props });
      return { type: 'Feature', id, geometry: a.geometry, properties: props };
    });
    ds.features = ds.features.concat(newFeats);
    inverse.deletes.push(...added);
    if (!ds.geomType) ds.geomType = geomTypeOf(newFeats.find((f) => f.geometry)?.geometry);
  }

  emit({ datasetId, type: 'edit', adds: added, updates: updated, deletes: deleted });

  if (opts.undoable !== false && (added.length || updated.length || deleted.length)) {
    pushUndo({
      label: opts.label ?? 'Edit features',
      undo: () => applyEdits(datasetId, inverse, { undoable: false }),
      redo: () => applyEdits(datasetId, forward, { undoable: false }),
    });
  }
  return added;
}

/** Replace all features (e.g. after a bulk operation). Not undoable. */
export function resetFeatures(datasetId: Id, features: Array<{ geometry: Geometry | null; properties: Record<string, any> | null }>) {
  const ds = datasets.get(datasetId);
  if (!ds) return;
  ds.features = features.map((f, i) => ({ type: 'Feature', id: i + 1, geometry: f.geometry, properties: { ...(f.properties ?? {}) } }));
  ds.nextFid = ds.features.length + 1;
  emit({ datasetId, type: 'reset' });
}

// ---------- fields ----------

export function addField(datasetId: Id, field: Field, defaultValue: any = null, opts: EditOptions = {}) {
  const ds = datasets.get(datasetId);
  if (!ds) return;
  if (ds.fields.some((f) => f.name === field.name)) throw new Error(`Field "${field.name}" already exists`);
  ds.fields = [...ds.fields, { ...field }];
  ds.features = ds.features.map((f) => ({ ...f, properties: { ...f.properties, [field.name]: defaultValue } }));
  emit({ datasetId, type: 'schema' });
  if (opts.undoable !== false)
    pushUndo({
      label: opts.label ?? `Add field ${field.name}`,
      undo: () => deleteField(datasetId, field.name, { undoable: false }),
      redo: () => addField(datasetId, field, defaultValue, { undoable: false }),
    });
}

export function deleteField(datasetId: Id, name: string, opts: EditOptions = {}) {
  const ds = datasets.get(datasetId);
  if (!ds) return;
  const index = ds.fields.findIndex((f) => f.name === name);
  if (index < 0) return;
  const field = ds.fields[index];
  const saved = new Map(ds.features.map((f) => [f.id, f.properties[name]]));
  ds.fields = ds.fields.filter((f) => f.name !== name);
  ds.features = ds.features.map((f) => {
    const { [name]: _drop, ...rest } = f.properties;
    return { ...f, properties: rest };
  });
  emit({ datasetId, type: 'schema' });
  if (opts.undoable !== false)
    pushUndo({
      label: opts.label ?? `Delete field ${name}`,
      undo: () => {
        const d = datasets.get(datasetId);
        if (!d) return;
        const fields = [...d.fields];
        fields.splice(index, 0, field);
        d.fields = fields;
        d.features = d.features.map((f) => ({ ...f, properties: { ...f.properties, [name]: saved.get(f.id) ?? null } }));
        emit({ datasetId, type: 'schema' });
      },
      redo: () => deleteField(datasetId, name, { undoable: false }),
    });
}

/** Change a field's name, alias and/or type (values are renamed/coerced). */
export function updateField(datasetId: Id, name: string, patch: Partial<Field>, opts: EditOptions = {}) {
  const ds = datasets.get(datasetId);
  if (!ds) return;
  const old = ds.fields.find((f) => f.name === name);
  if (!old) return;
  const next: Field = { ...old, ...patch };
  if (next.name !== name && ds.fields.some((f) => f.name === next.name)) throw new Error(`Field "${next.name}" already exists`);
  const before = { fields: ds.fields, features: ds.features };
  ds.fields = ds.fields.map((f) => (f.name === name ? next : f));
  if (next.name !== name || next.type !== old.type) {
    ds.features = ds.features.map((f) => {
      const { [name]: v, ...rest } = f.properties;
      return { ...f, properties: { ...rest, [next.name]: next.type !== old.type ? coerce(v, next.type) : v } };
    });
  }
  const after = { fields: ds.fields, features: ds.features };
  emit({ datasetId, type: 'schema' });
  if (opts.undoable !== false) {
    const restore = (s: typeof before) => {
      const d = datasets.get(datasetId);
      if (!d) return;
      d.fields = s.fields;
      d.features = s.features;
      emit({ datasetId, type: 'schema' });
    };
    pushUndo({ label: opts.label ?? `Modify field ${name}`, undo: () => restore(before), redo: () => restore(after) });
  }
}

/** Set one field for many features in a single undoable step. */
export function setFieldValues(datasetId: Id, field: string, values: Map<number, any>, label = `Calculate ${field}`) {
  const updates = [...values].map(([id, v]) => ({ id, properties: { [field]: v } }));
  return applyEdits(datasetId, { updates }, { label });
}

export { transaction, withoutHistory };

// ---------- React hooks ----------

/** Dataset object (stable reference) that re-renders the component when the dataset changes. */
export function useDataset(id: Id | undefined | null): Dataset | undefined {
  useSyncExternalStore(subscribeData, () => (id ? versions.get(id) ?? 0 : 0));
  return id ? datasets.get(id) : undefined;
}
export function useDatasetVersion(id: Id | undefined | null): number {
  return useSyncExternalStore(subscribeData, () => (id ? versions.get(id) ?? 0 : 0));
}
/** Re-renders on any dataset change; returns all datasets. */
export function useAllDatasets(): Dataset[] {
  useSyncExternalStore(subscribeData, () => globalVersion);
  return allDatasets();
}
export const datasetVersion = (id: Id) => versions.get(id) ?? 0;

// ---------- blob store (rasters, images) ----------

const blobs = new Map<Id, Blob>();
export function putBlob(blob: Blob, id: Id = uid('blob')): Id {
  blobs.set(id, blob);
  return id;
}
export const getBlob = (id: Id | undefined): Blob | undefined => (id ? blobs.get(id) : undefined);
export const allBlobs = (): Map<Id, Blob> => blobs;
