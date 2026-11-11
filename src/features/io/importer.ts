// Import orchestration: parsed layers -> datasets + layers on the active map. (Store side effects live here;
// parsing is in ./parse and is pure.)

import type { Feature as GJFeature } from 'geojson';
import { ensureCrs } from '../../core/crs';
import { createDataset, datasetExtent, putBlob, splitByGeomType, uid } from '../../core/data';
import { addLayer, addDatasetLayer, addMap, getMap } from '../../core/store';
import { notify, openDialog, openView, setActiveLayer, setBusy, useUi } from '../../core/ui';
import type { Dataset, Extent, GeomType, Id, RasterLayer, TileLayer, TileSource } from '../../core/types';
import { getMapHandle } from '../../map/handle';
import { type Feature, extOf, type ParsedLayer, type ParsedRaster } from './model';
import { isShapefilePart, parseBuffer, parseShapefileParts, type Parsed } from './parse';
import { tableToFeatures, type Table, type CsvDetection } from './parse/csv';

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Yield to the browser so the busy indicator can paint. */
export const tick = () =>
  new Promise<void>((r) => {
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fin, 0));
    setTimeout(fin, 60); // rAF does not fire in background tabs
  });

export const fmtCount = (n: number) => n.toLocaleString();

// ---------- map helpers ----------

/** The active map's id, creating and opening a map when the project has none. */
export function ensureActiveMap(): Id {
  const active = useUi.getState().activeMapId;
  if (active && getMap(active)) return active;
  const m = addMap();
  openView('map', m.id);
  return m.id;
}

export async function zoomToExtentWhenReady(mapId: Id, extent: Extent | null | undefined) {
  if (!extent) return;
  for (let i = 0; i < 60; i++) {
    const h = getMapHandle(mapId);
    if (h) {
      h.zoomToExtent(extent, { padding: 48, maxZoom: 15, animate: true });
      return;
    }
    await sleep(50);
  }
}

export function unionExtent(a: Extent | null, b: Extent | null | undefined): Extent | null {
  if (!b) return a;
  if (!a) return [...b] as Extent;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Add a dataset to a map as a feature layer (tables are skipped). Returns the new layer id. */
export function addDatasetToMap(ds: Dataset, mapId: Id = ensureActiveMap(), name?: string): Id | null {
  if (!ds.geomType) return null;
  const layer = addDatasetLayer(mapId, ds, name ? { name } : {});
  return layer.id;
}

export function addTileLayerToMap(name: string, source: TileSource, mapId: Id = ensureActiveMap()): TileLayer {
  const layer: TileLayer = { id: uid('lyr'), kind: 'tile', name, visible: true, opacity: 1, source };
  addLayer(mapId, layer, Number.MAX_SAFE_INTEGER);
  return layer;
}

// ---------- parsed layers -> datasets ----------

const FAMILY_SUFFIX: Record<GeomType | 'Table', string> = { Point: 'points', LineString: 'lines', Polygon: 'polygons', Table: 'table' };

export interface BuiltDatasets {
  datasets: Dataset[];
  notes: string[];
}

/** Create datasets for one parsed layer: one per geometry family, named "name (points)" when mixed. */
export function datasetsFromParsed(layer: ParsedLayer, source: string): BuiltDatasets {
  const notes: string[] = [...(layer.warnings ?? [])];
  const groups = splitByGeomType(layer.features as GJFeature[]) as Partial<Record<GeomType | 'Table', Feature[]>>;
  const families = (Object.keys(groups) as Array<GeomType | 'Table'>).filter((k) => k !== 'Table');
  const table = groups.Table;
  const datasets: Dataset[] = [];
  if (families.length === 1 && table?.length) {
    // rows without a location stay with the single geometry family
    groups[families[0]] = [...groups[families[0]]!, ...table];
    delete groups.Table;
    notes.push(`${fmtCount(table.length)} feature(s) have no geometry`);
  }
  const keys = Object.keys(groups) as Array<GeomType | 'Table'>;
  for (const k of keys) {
    const features: Feature[] = groups[k]!;
    const name = keys.length > 1 ? `${layer.name} (${FAMILY_SUFFIX[k]})` : layer.name;
    datasets.push(createDataset({ name, features, geomType: k === 'Table' ? null : k, source, fields: keys.length === 1 ? layer.fields : undefined }));
  }
  return { datasets, notes };
}

// ---------- the import pipeline ----------

export interface ImportSummary {
  datasets: Dataset[];
  rasters: number;
  tables: number;
}

/** Add datasets and rasters to the active map, zoom to them and notify. */
export async function commitImport(layers: Array<{ layer: ParsedLayer; source: string }>, rasters: Array<{ raster: ParsedRaster; source: string }> = []): Promise<ImportSummary> {
  const mapId = ensureActiveMap();
  const all: Dataset[] = [];
  const notes: string[] = [];
  let extent: Extent | null = null;
  let firstLayer: Id | null = null;
  let tables = 0;
  for (const { layer, source } of layers) {
    const built = datasetsFromParsed(layer, source);
    notes.push(...built.notes);
    for (const ds of built.datasets) {
      all.push(ds);
      if (!ds.geomType) {
        tables++;
        continue;
      }
      const id = addDatasetToMap(ds, mapId);
      firstLayer ??= id;
      extent = unionExtent(extent, datasetExtent(ds.id));
    }
    await tick();
  }
  for (const { raster } of rasters) {
    const blobId = putBlob(raster.blob);
    const layer: RasterLayer = { id: uid('lyr'), kind: 'raster', name: raster.name, visible: true, opacity: 1, blobId };
    addLayer(mapId, layer, Number.MAX_SAFE_INTEGER);
    firstLayer ??= layer.id;
    extent = unionExtent(extent, raster.extent);
  }
  if (firstLayer) setActiveLayer(firstLayer);
  void zoomToExtentWhenReady(mapId, extent);

  const features = all.reduce((n, d) => n + d.features.length, 0);
  const parts: string[] = [];
  const mapped = all.length - tables;
  if (mapped) parts.push(`${mapped} layer${mapped === 1 ? '' : 's'}`);
  if (rasters.length) parts.push(`${rasters.length} raster${rasters.length === 1 ? '' : 's'}`);
  if (tables) parts.push(`${tables} table${tables === 1 ? '' : 's'}`);
  if (parts.length) {
    const first = all[0]?.name ?? rasters[0]?.raster.name;
    notify(`Added ${parts.join(', ')}${features ? ` (${fmtCount(features)} features)` : ''}${all.length + rasters.length === 1 ? ` from "${first}"` : ''}.${notes.length ? ' ' + notes.join('. ') + '.' : ''}`, notes.length ? 'warning' : 'success');
  }
  return { datasets: all, rasters: rasters.length, tables };
}

// ---------- CSV dialog bridge ----------

export interface CsvChoice {
  mode: 'xy' | 'wkt' | 'table';
  x: string | null;
  y: string | null;
  wkt: string | null;
  crs: string;
}

export function askCsvOptions(name: string, table: Table, detection: CsvDetection): Promise<CsvChoice | null> {
  return new Promise((resolve) => openDialog('io.csv', { name, table, detection, resolve }));
}

export async function csvToLayer(name: string, table: Table, choice: CsvChoice): Promise<ParsedLayer> {
  const warnings: string[] = [];
  if (!table.rows.length) throw new Error('The file has a header row but no data rows');
  let crs = 'EPSG:4326';
  if (choice.mode !== 'table') {
    crs = choice.crs;
    if (!(await ensureCrs(crs))) throw new Error(`Coordinate system ${crs} could not be loaded`);
  }
  const { features, located } =
    choice.mode === 'xy' ? tableToFeatures(table, { x: choice.x, y: choice.y, crs })
    : choice.mode === 'wkt' ? tableToFeatures(table, { wkt: choice.wkt, crs })
    : tableToFeatures(table, {});
  if (choice.mode !== 'table' && located === 0) throw new Error('None of the rows could be placed on the map. Check the X/Y fields and the coordinate system.');
  if (choice.mode !== 'table' && located < features.length) warnings.push(`${fmtCount(features.length - located)} of ${fmtCount(features.length)} rows had no valid location`);
  return { name, features, warnings };
}

// ---------- entry points ----------

/** Import dropped / picked files. Handles loose shapefile parts and .terrane projects. */
export async function importFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  const layers: Array<{ layer: ParsedLayer; source: string }> = [];
  const rasters: Array<{ raster: ParsedRaster; source: string }> = [];
  const errors: string[] = [];
  const loose = files.filter((f) => isShapefilePart(f.name) && extOf(f.name) !== 'zip');
  const rest = files.filter((f) => !loose.includes(f));
  try {
    const parsedItems: Array<{ parsed: Parsed; file: string }> = [];
    if (loose.length) {
      setBusy('Reading shapefile…');
      await tick();
      try {
        const bufs = await Promise.all(loose.filter((f) => extOf(f.name) !== 'shx').map(async (f) => ({ name: f.name, buffer: await f.arrayBuffer() })));
        for (const p of await parseShapefileParts(bufs)) parsedItems.push({ parsed: p, file: loose[0].name });
      } catch (e: any) {
        errors.push(`${loose.map((f) => f.name).join(', ')}: ${e?.message ?? e}`);
      }
    }
    for (const f of rest) {
      setBusy(`Reading ${f.name}…`);
      await tick();
      try {
        for (const p of await parseBuffer(f.name, await f.arrayBuffer())) parsedItems.push({ parsed: p, file: f.name });
      } catch (e: any) {
        console.error(e);
        errors.push(`${f.name}: ${e?.message ?? e}`);
      }
    }
    for (const { parsed, file } of parsedItems) {
      if (parsed.kind === 'layers') parsed.layers.forEach((layer) => layers.push({ layer, source: file }));
      else if (parsed.kind === 'raster') rasters.push({ raster: parsed.raster, source: file });
      else if (parsed.kind === 'csv') {
        setBusy(null);
        const choice = await askCsvOptions(parsed.name, parsed.table, parsed.detection);
        if (!choice) continue;
        setBusy(`Importing ${file}…`);
        try {
          layers.push({ layer: await csvToLayer(parsed.name, parsed.table, choice), source: file });
        } catch (e: any) {
          errors.push(`${file}: ${e?.message ?? e}`);
        }
      } else if (parsed.kind === 'project') {
        setBusy(null);
        const { openProjectJson } = await import('./persist');
        await openProjectJson(parsed.json, file);
        return;
      }
    }
    setBusy('Adding to map…');
    await tick();
    if (layers.length || rasters.length) await commitImport(layers, rasters);
  } finally {
    setBusy(null);
  }
  for (const e of errors) notify(e, 'error');
}

/** Network errors (CORS, offline) look alike in the browser; give one clear message. */
export function networkMessage(url: string, err: any): string {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw */
  }
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message))) {
    return `Could not reach ${host}. The server may be offline, or it does not allow requests from the browser (CORS). Download the file and add it from disk instead.`;
  }
  return String(err?.message ?? err);
}

export async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(networkMessage(url, e));
  }
  if (!res.ok) throw new Error(`${new URL(url, location.href).host} answered ${res.status} ${res.statusText}`.trim());
  return res.arrayBuffer();
}

export async function importUrl(url: string, nameHint?: string): Promise<void> {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('Enter a full http(s) URL');
  setBusy('Downloading…');
  try {
    const buf = await fetchBuffer(url);
    const path = new URL(url).pathname;
    let fileName = decodeURIComponent(path.split('/').filter(Boolean).pop() ?? '') || nameHint || 'download';
    if (!extOf(fileName) && nameHint) fileName = nameHint;
    const file = new File([buf], fileName);
    setBusy(null);
    await importFiles([file]);
  } finally {
    setBusy(null);
  }
}

