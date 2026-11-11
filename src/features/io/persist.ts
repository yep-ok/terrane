// Project persistence: .terrane files (File System Access API with download fallback) and the
// IndexedDB autosave that restores the previous session at startup.
import { del, delMany, get, getMany, keys, set, setMany } from 'idb-keyval';
import { allBlobs, allDatasets, datasetVersion, putBlob, subscribeData } from '../../core/data';
import { getProject, loadProjectFile, markSaved, newProject, renameProject, toProjectFile, useProject, addMap } from '../../core/store';
import { activateView, notify, openView, resetSession, setBusy, useUi } from '../../core/ui';
import type { Dataset, Id, Project, ProjectFile } from '../../core/types';
import { downloadBlob, pickFiles } from '../../ui/kit';
import { baseName } from './model';
import { safeFileName } from './export/formats';
import { choiceDialog, promptDialog } from './dialogs/common';
import { tick } from './importer';

// ---------- serialisation ----------

export interface TerraneFile extends ProjectFile {
  app?: 'Terrane';
  savedAt?: string;
  blobs?: Record<string, { type: string; data: string }>;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(data: string, type: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Serialise the open project (datasets one by one so no single giant string is built). */
export async function projectToBlob(): Promise<Blob> {
  const pf = toProjectFile();
  const parts: BlobPart[] = [`{"format":"terrane-project","app":"Terrane","savedAt":${JSON.stringify(new Date().toISOString())},"project":${JSON.stringify(pf.project)},"datasets":[`];
  for (let i = 0; i < pf.datasets.length; i++) {
    if (i) parts.push(',');
    parts.push(JSON.stringify(pf.datasets[i]));
    if (i % 4 === 3) await tick();
  }
  parts.push('],"blobs":{');
  let first = true;
  for (const [id, blob] of allBlobs()) {
    parts.push(`${first ? '' : ','}${JSON.stringify(id)}:${JSON.stringify({ type: blob.type, data: await blobToBase64(blob) })}`);
    first = false;
  }
  parts.push('}}');
  return new Blob(parts, { type: 'application/json' });
}

/** Make sure a dataset read from disk satisfies the Dataset contract. */
function sanitizeDataset(ds: Dataset): Dataset {
  const features = Array.isArray(ds.features) ? ds.features : [];
  let max = 0;
  for (const f of features) if (typeof f.id === 'number' && f.id > max) max = f.id;
  return { ...ds, features, fields: Array.isArray(ds.fields) ? ds.fields : [], geomType: ds.geomType ?? null, nextFid: Math.max(ds.nextFid ?? 0, max + 1) };
}

export function validateProjectFile(json: any): asserts json is TerraneFile {
  if (!json || json.format !== 'terrane-project' || !json.project || !Array.isArray(json.project.maps)) throw new Error('This is not a Terrane project file');
  if (!Array.isArray(json.datasets)) json.datasets = [];
}

/** Replace the current session with a project file's content and reopen its map. */
export function loadTerraneFile(json: TerraneFile) {
  validateProjectFile(json);
  resetSession();
  loadProjectFile({ ...json, datasets: json.datasets.map(sanitizeDataset) });
  for (const [id, b] of Object.entries(json.blobs ?? {})) putBlob(base64ToBlob(b.data, b.type), id);
  openInitialViews();
}

function openInitialViews() {
  const p = getProject();
  const map = p.maps[0] ?? addMap();
  openView('map', map.id);
}

// ---------- file handles ----------

let currentHandle: any = null;
let currentFileName: string | null = null;
export const currentProjectFile = () => currentFileName;

const hasFsa = () => typeof (window as any).showSaveFilePicker === 'function';
const PICKER_TYPES = [{ description: 'Terrane project', accept: { 'application/json': ['.terrane'] } }];

async function ensurePermission(handle: any, mode: 'readwrite' | 'read'): Promise<boolean> {
  try {
    if ((await handle.queryPermission?.({ mode })) === 'granted') return true;
    return (await handle.requestPermission?.({ mode })) === 'granted';
  } catch {
    return false;
  }
}

function setHandle(handle: any, name: string | null) {
  currentHandle = handle;
  currentFileName = name;
  void (handle ? set(HANDLE_KEY, handle) : del(HANDLE_KEY)).catch(() => undefined);
}

async function confirmDiscard(action: string): Promise<boolean> {
  if (!useProject.getState().dirty) return true;
  const r = await choiceDialog({
    title: action,
    message: `"${getProject().name}" has unsaved changes. Save them before continuing?`,
    confirmLabel: 'Save',
    altLabel: "Don't save",
  });
  if (r === 'alt') return true;
  if (r === true) return saveProject();
  return false;
}

// ---------- commands ----------

export async function newProjectCommand() {
  if (!(await confirmDiscard('New project'))) return;
  resetSession();
  newProject('Untitled');
  setHandle(null, null);
  openInitialViews();
  markSaved();
  scheduleAutosave();
}

export async function openProjectJson(json: any, fileName?: string, handle: any = null): Promise<boolean> {
  validateProjectFile(json);
  if (!(await confirmDiscard('Open project'))) return false;
  setBusy('Opening project…');
  await tick();
  try {
    loadTerraneFile(json);
    if (fileName && (!json.project.name || json.project.name === 'Untitled')) renameProject(baseName(fileName));
    markSaved();
    setHandle(handle, fileName ?? null);
    scheduleAutosave();
    notify(`Opened "${getProject().name}"`, 'success');
    return true;
  } finally {
    setBusy(null);
  }
}

export async function openProjectCommand() {
  let file: File | undefined;
  let handle: any = null;
  if (typeof (window as any).showOpenFilePicker === 'function') {
    try {
      [handle] = await (window as any).showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      file = await handle.getFile();
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    }
  } else {
    file = (await pickFiles('.terrane,.json', false))[0];
  }
  if (!file) return;
  setBusy('Reading project…');
  let json: any;
  try {
    await tick();
    json = JSON.parse(await file.text());
  } catch {
    setBusy(null);
    throw new Error('The file is not a valid Terrane project');
  }
  setBusy(null);
  await openProjectJson(json, file.name, handle);
}

/** Save to the current file, asking for a location the first time. Resolves false when cancelled. */
export async function saveProject(forceDialog = false): Promise<boolean> {
  const name = safeFileName(getProject().name);
  let handle = forceDialog ? null : currentHandle;
  if (handle && !(await ensurePermission(handle, 'readwrite'))) handle = null;
  if (!handle && hasFsa()) {
    try {
      handle = await (window as any).showSaveFilePicker({ suggestedName: `${name}.terrane`, types: PICKER_TYPES });
    } catch (e: any) {
      if (e?.name === 'AbortError') return false;
      handle = null; // picker unavailable (e.g. no user gesture, sandboxed frame): fall back to a download
    }
  }
  setBusy('Saving project…');
  try {
    await tick();
    const blob = await projectToBlob();
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      setHandle(handle, handle.name);
      if (getProject().name === 'Untitled') renameProject(baseName(handle.name));
    } else {
      downloadBlob(blob, `${name}.terrane`);
      setHandle(null, `${name}.terrane`);
    }
    markSaved();
    scheduleAutosave();
    notify(handle ? `Saved ${handle.name}` : `Downloaded ${name}.terrane`, 'success');
    return true;
  } finally {
    setBusy(null);
  }
}

export const saveProjectAs = () => saveProject(true);

export async function renameProjectCommand() {
  const name = await promptDialog({ title: 'Rename project', label: 'Project name', value: getProject().name, confirmLabel: 'Rename' });
  if (name && name !== getProject().name) renameProject(name);
}

// ---------- autosave (IndexedDB) ----------

const MANIFEST_KEY = 'terrane:manifest';
const HANDLE_KEY = 'terrane:handle';
const DS_PREFIX = 'terrane:ds:';
const BLOB_PREFIX = 'terrane:blob:';

interface Manifest {
  project: Project;
  dsIds: Id[];
  blobIds: Id[];
  views: Array<{ type: 'map' | 'layout' | 'chart'; refId: Id }>;
  active: { type: 'map' | 'layout' | 'chart'; refId: Id } | null;
  dirty: boolean;
  fileName: string | null;
  savedAt: number;
}

const savedVersions = new Map<Id, number>();
const savedBlobs = new Set<Id>();
let unsaved = false;
let changeCounter = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
let again = false;
let armed = false;

export function scheduleAutosave(delay = 2000) {
  if (!armed) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushAutosave(), delay);
}

export async function flushAutosave() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (writing) {
    again = true;
    return;
  }
  writing = true;
  try {
    do {
      again = false;
      await writeAutosave();
    } while (again);
  } catch (e) {
    console.warn('Autosave failed', e);
  } finally {
    writing = false;
  }
}

async function writeAutosave() {
  const startCounter = changeCounter;
  const datasets = allDatasets();
  const current = new Set(datasets.map((d) => d.id));
  const writes: Array<[string, unknown]> = [];
  const versions = new Map<Id, number>();
  for (const d of datasets) {
    const v = datasetVersion(d.id);
    versions.set(d.id, v);
    if (savedVersions.get(d.id) !== v) writes.push([DS_PREFIX + d.id, d]);
  }
  const blobs = allBlobs();
  for (const [id, b] of blobs) if (!savedBlobs.has(id)) writes.push([BLOB_PREFIX + id, b]);
  if (writes.length) await setMany(writes);
  const ui = useUi.getState();
  const av = ui.views.find((v) => v.id === ui.activeViewId);
  const manifest: Manifest = {
    project: getProject(),
    dsIds: [...current],
    blobIds: [...blobs.keys()],
    views: ui.views.map((v) => ({ type: v.type, refId: v.refId })),
    active: av ? { type: av.type, refId: av.refId } : null,
    dirty: useProject.getState().dirty,
    fileName: currentFileName,
    savedAt: Date.now(),
  };
  await set(MANIFEST_KEY, manifest);
  versions.forEach((v, id) => savedVersions.set(id, v));
  for (const id of [...savedVersions.keys()]) if (!current.has(id)) savedVersions.delete(id);
  blobs.forEach((_, id) => savedBlobs.add(id));
  // drop records of deleted datasets / blobs
  const stale = (await keys()).filter((k) => typeof k === 'string' && ((k.startsWith(DS_PREFIX) && !current.has(k.slice(DS_PREFIX.length))) || (k.startsWith(BLOB_PREFIX) && !blobs.has(k.slice(BLOB_PREFIX.length)))));
  if (stale.length) await delMany(stale);
  for (const id of [...savedBlobs]) if (!blobs.has(id)) savedBlobs.delete(id);
  if (changeCounter === startCounter) unsaved = false;
}

/** Restore the autosaved session. Returns false when there is none (or it is unreadable). */
export async function restoreAutosave(): Promise<boolean> {
  try {
    const m = await get<Manifest>(MANIFEST_KEY);
    if (!m?.project || !Array.isArray(m.dsIds)) return false;
    const dsList = await getMany<Dataset>(m.dsIds.map((id) => DS_PREFIX + id));
    if (dsList.some((d) => !d)) return false;
    const blobList = await getMany<Blob>((m.blobIds ?? []).map((id) => BLOB_PREFIX + id));
    resetSession();
    loadProjectFile({ format: 'terrane-project', project: m.project, datasets: dsList as Dataset[] });
    (m.blobIds ?? []).forEach((id, i) => blobList[i] && putBlob(blobList[i]!, id));
    const p = getProject();
    const exists = (v: { type: string; refId: Id }) => (v.type === 'map' ? p.maps : v.type === 'layout' ? p.layouts : p.charts).some((x) => x.id === v.refId);
    for (const v of m.views ?? []) if (exists(v)) openView(v.type, v.refId);
    if (!useUi.getState().views.length) openInitialViews();
    else if (m.active && exists(m.active)) openView(m.active.type, m.active.refId);
    else activateView(useUi.getState().views[0].id);
    useProject.setState({ dirty: !!m.dirty });
    for (const d of allDatasets()) savedVersions.set(d.id, datasetVersion(d.id));
    for (const id of m.blobIds ?? []) savedBlobs.add(id);
    currentFileName = m.fileName ?? null;
    try {
      currentHandle = (await get(HANDLE_KEY)) ?? null;
    } catch {
      currentHandle = null;
    }
    return true;
  } catch (e) {
    console.warn('Could not restore the autosaved session', e);
    return false;
  }
}

/** Start autosaving and the unload guard. Call once after the first project is in place. */
export function armAutosave() {
  if (armed) return;
  armed = true;
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project && s.dirty === prev.dirty) return;
    changeCounter++;
    // view-only changes (pan/zoom) are autosaved but do not warn on unload
    if (s.dirty || s.project.maps.length !== prev.project.maps.length) unsaved = true;
    scheduleAutosave();
  });
  subscribeData(() => {
    changeCounter++;
    unsaved = true;
    scheduleAutosave();
  });
  window.addEventListener('beforeunload', (e) => {
    if (unsaved) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushAutosave();
  });
  document.title = `${getProject().name} - Terrane`;
  useProject.subscribe((s, prev) => {
    if (s.project.name !== prev.project.name) document.title = `${s.project.name} - Terrane`;
  });
  scheduleAutosave(500);
}
