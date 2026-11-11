// io module entry point: data import/export, project persistence and the Catalog pane.
import { Cloud, Database, Download, FileUp, FolderOpen, ImageDown, Link2, MapPlus, Pencil, Plus, Save, SaveAll, Sparkles, FilePlus2 } from 'lucide-react';
import { registerCommand, registerDialog, registerPane, registerRibbonGroup } from '../../core/registry';
import { addMap, findLayer, getMap } from '../../core/store';
import { notify, openDialog, openView, useUi } from '../../core/ui';
import { downloadBlob } from '../../ui/kit';
import { getMapHandle } from '../../map/handle';
import { CatalogPane } from './catalog/CatalogPane';
import { AddDataDialog } from './dialogs/AddDataDialog';
import { CsvDialog } from './dialogs/CsvDialog';
import { ExportDialog } from './dialogs/ExportDialog';
import { DatasetPropertiesDialog } from './dialogs/PropertiesDialog';
import { ConfirmDialog, PromptDialog } from './dialogs/common';
import { importFiles } from './importer';
import { safeFileName } from './export/formats';
import { armAutosave, newProjectCommand, openProjectCommand, renameProjectCommand, restoreAutosave, saveProject, saveProjectAs } from './persist';
import { buildStarterProject, createSampleMap } from './samples';
import './io.css';

// ---------- drag and drop anywhere on the window ----------

const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>';

function readEntries(reader: any): Promise<any[]> {
  return new Promise((resolve) => reader.readEntries((e: any[]) => resolve(e), () => resolve([])));
}
async function walk(entry: any, out: File[]) {
  if (entry.isFile) {
    await new Promise<void>((resolve) =>
      entry.file((f: File) => {
        out.push(f);
        resolve();
      }, () => resolve()),
    );
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await readEntries(reader);
      if (!batch.length) break;
      for (const e of batch) await walk(e, out);
    }
  }
}

/** Files from a drop, descending into dropped folders (e.g. a shapefile directory). */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => (i as any).webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return Array.from(dt.files);
  const out: File[] = [];
  for (const e of entries) await walk(e, out);
  return out;
}

function installDropZone() {
  if (typeof document === 'undefined' || document.querySelector('.io-dropoverlay')) return;
  const el = document.createElement('div');
  el.className = 'io-dropoverlay';
  el.innerHTML = `<div class="box">${ICON_UPLOAD}<div class="t">Drop files to add them to the map</div><div class="s">GeoJSON, shapefile, KML, GPX, CSV, FlatGeobuf, GeoTIFF or a .terrane project</div></div>`;
  document.body.appendChild(el);
  let depth = 0;
  const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  const hide = () => {
    depth = 0;
    el.classList.remove('show');
  };
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    depth++;
    el.classList.add('show');
  });
  window.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) el.classList.remove('show');
  });
  window.addEventListener('dragend', hide);
  window.addEventListener('drop', (e) => {
    const wasFiles = hasFiles(e);
    hide();
    if (!wasFiles) return;
    // a component (e.g. the dialog drop zone) that handled the drop has already called preventDefault
    if (e.defaultPrevented) return;
    e.preventDefault();
    const dt = e.dataTransfer!;
    void droppedFiles(dt).then((files) => importFiles(files)).catch((err) => notify(String(err?.message ?? err), 'error'));
  });
}

// ---------- commands & ribbon ----------

const activeMapHandle = () => getMapHandle();

async function exportMapImage() {
  const handle = activeMapHandle();
  if (!handle) {
    notify('Open a map view to export its image.', 'warning');
    return;
  }
  const canvas = await handle.toCanvas();
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The map could not be rendered to an image (a tile server may not allow cross-origin use)');
  const name = safeFileName(getMap(handle.mapId)?.name ?? 'map');
  downloadBlob(blob, `${name}.png`);
  notify(`Saved ${name}.png (${canvas.width} x ${canvas.height})`, 'success');
}

export function register() {
  registerDialog({ id: 'data.add', title: 'Add Data', width: 640, component: AddDataDialog });
  registerDialog({ id: 'io.csv', title: (p) => `Import ${p?.name ?? 'table'}`, width: 600, component: CsvDialog });
  registerDialog({ id: 'io.export', title: 'Export Features', width: 500, component: ExportDialog });
  registerDialog({ id: 'io.dataset-properties', title: 'Dataset Properties', width: 520, component: DatasetPropertiesDialog });
  registerDialog({ id: 'io.confirm', title: (p) => p?.title ?? 'Confirm', component: ConfirmDialog });
  registerDialog({ id: 'io.prompt', title: (p) => p?.title ?? 'Name', width: 380, component: PromptDialog });

  registerPane({ id: 'catalog', title: 'Catalog', icon: Database, dock: 'right', component: CatalogPane });

  registerCommand({ id: 'project.new', title: 'New Project', icon: FilePlus2, description: 'Start an empty project (asks to save changes first).', keywords: 'blank clear', run: newProjectCommand });
  registerCommand({ id: 'project.open', title: 'Open Project', icon: FolderOpen, description: 'Open a .terrane project file.', shortcut: 'Ctrl+O', run: openProjectCommand });
  registerCommand({ id: 'project.save', title: 'Save Project', icon: Save, description: 'Save the project to its .terrane file.', shortcut: 'Ctrl+S', run: async () => void (await saveProject()) });
  registerCommand({ id: 'project.saveAs', title: 'Save Project As', icon: SaveAll, description: 'Save the project under a new file name.', shortcut: 'Ctrl+Shift+S', run: async () => void (await saveProjectAs()) });
  registerCommand({ id: 'project.rename', title: 'Rename Project', icon: Pencil, run: renameProjectCommand });

  const openTab = (tab: string) => () => openDialog('data.add', { tab });
  registerCommand({ id: 'data.add', title: 'Add Data', icon: Plus, description: 'Add files, URLs, web services or sample data to the map.', keywords: 'import open load layer file', run: (arg) => openDialog('data.add', { tab: typeof arg === 'string' ? arg : 'files' }) });
  registerCommand({ id: 'data.addFiles', title: 'Add Data from Files', icon: FileUp, keywords: 'import shapefile geojson csv kml gpx tif', run: openTab('files') });
  registerCommand({ id: 'data.addUrl', title: 'Add Data from URL', icon: Link2, keywords: 'import download http', run: openTab('url') });
  registerCommand({ id: 'data.addServices', title: 'Add Web Service', icon: Cloud, keywords: 'wms wfs xyz tiles arcgis featureserver mapserver', run: openTab('services') });
  registerCommand({ id: 'data.addSamples', title: 'Add Sample Data', icon: Sparkles, keywords: 'countries cities graticule example', run: openTab('samples') });
  registerCommand({ id: 'data.sampleMap', title: 'New World Map', icon: MapPlus, description: 'Create a map with sample countries and cities.', run: createSampleMap });

  registerCommand({
    id: 'layer.export', title: 'Export Features', icon: Download, description: 'Export a layer to GeoJSON, Shapefile, KML, GPX or CSV.', keywords: 'save download convert shapefile geojson kml gpx csv',
    run: (arg) => {
      const layerId = typeof arg === 'string' ? arg : useUi.getState().activeLayerId ?? undefined;
      if (layerId && findLayer(layerId)?.layer.kind !== 'feature') return notify('Select a feature layer to export.', 'warning');
      openDialog('io.export', { layerId });
    },
  });
  registerCommand({ id: 'map.exportImage', title: 'Export Map Image', icon: ImageDown, description: 'Save the current map view as a PNG image.', keywords: 'png picture screenshot', run: exportMapImage });

  registerRibbonGroup({
    tab: 'project', id: 'project', title: 'Project', order: 10,
    items: [
      { type: 'button', command: 'project.new', size: 'large', label: 'New' },
      { type: 'button', command: 'project.open', size: 'large', label: 'Open' },
      { type: 'button', command: 'project.save', size: 'large', label: 'Save' },
      { type: 'stack', items: [{ type: 'button', command: 'project.saveAs', size: 'small', label: 'Save As' }, { type: 'button', command: 'project.rename', size: 'small', label: 'Rename' }] },
    ],
  });
  registerRibbonGroup({
    tab: 'project', id: 'export', title: 'Export', order: 20,
    items: [{ type: 'button', command: 'layer.export', size: 'large', label: 'Export Features' }, { type: 'button', command: 'map.exportImage', size: 'large', label: 'Map Image' }],
  });
  registerRibbonGroup({
    tab: 'map', id: 'layer', title: 'Layer', order: 20,
    items: [{ type: 'split', command: 'data.add', size: 'large', label: 'Add Data', items: ['data.addFiles', 'data.addUrl', 'data.addServices', 'separator', 'data.addSamples'] }],
  });
  registerRibbonGroup({
    tab: 'insert', id: 'data', title: 'Data', order: 20,
    items: [
      { type: 'button', command: 'data.add', size: 'large', label: 'Add Data' },
      { type: 'stack', items: [{ type: 'button', command: 'data.addUrl', size: 'small', label: 'From URL' }, { type: 'button', command: 'data.addServices', size: 'small', label: 'Web Service' }, { type: 'button', command: 'data.addSamples', size: 'small', label: 'Sample Data' }] },
      { type: 'button', command: 'data.sampleMap', size: 'large', label: 'World Map' },
    ],
  });
  registerRibbonGroup({
    tab: 'share', id: 'export', title: 'Export', order: 10,
    items: [{ type: 'button', command: 'layer.export', size: 'large', label: 'Export Features' }, { type: 'button', command: 'map.exportImage', size: 'large', label: 'Map Image' }],
  });
  registerRibbonGroup({
    tab: 'layer', id: 'export', title: 'Export', order: 50,
    items: [{ type: 'button', command: 'layer.export', size: 'large', label: 'Export Features' }],
  });

  installDropZone();
}

/** Called once at boot after all modules registered: restore the last session or create a starter project. */
export async function startup(): Promise<void> {
  let restored = false;
  try {
    restored = await restoreAutosave();
  } catch (err) {
    console.warn('Restore failed', err);
  }
  if (!restored) {
    try {
      await buildStarterProject();
    } catch (err) {
      console.error('Starter project failed', err);
      openView('map', addMap().id); // never leave the app without a map
    }
  }
  armAutosave();
}
