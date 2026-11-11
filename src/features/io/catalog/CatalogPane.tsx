// Catalog pane: the project tree (maps, layouts, charts, data) with search, context menus and file drop.
import { useMemo, useState } from 'react';
import {
  ChartColumn, ChevronDown, ChevronRight, CircleDot, Database, Download, FolderOpen, Info, LayoutTemplate, Map as MapIcon, MapPlus, Pencil,
  Pentagon, Plus, Search, Spline, Table2, Trash2, Upload, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Empty, IconButton, cx } from '../../../ui/kit';
import { datasetExtent, removeDataset, renameDataset, useAllDatasets } from '../../../core/data';
import { addMap, getProject, removeChart, removeLayer, removeLayout, removeMap, updateChart, updateLayout, updateMap, useProject } from '../../../core/store';
import { notify, openDialog, openView, showContextMenu, useUi, type MenuItem } from '../../../core/ui';
import { runCommand } from '../../../core/registry';
import type { Dataset, Id } from '../../../core/types';
import { confirmDialog, promptDialog } from '../dialogs/common';
import { datasetUsage } from '../dialogs/PropertiesDialog';
import { addDatasetToMap, ensureActiveMap, zoomToExtentWhenReady } from '../importer';

type Section = 'maps' | 'layouts' | 'charts' | 'data';

const GEOM_ICON: Record<string, LucideIcon> = { Point: CircleDot, LineString: Spline, Polygon: Pentagon };
const GEOM_NAME: Record<string, string> = { Point: 'Point', LineString: 'Line', Polygon: 'Polygon' };

interface Item {
  key: string;
  section: Section;
  id: Id;
  name: string;
  icon: LucideIcon;
  meta?: string;
  title?: string;
}

// ---------- actions ----------

function addDatasetToActiveMap(ds: Dataset) {
  if (!ds.geomType) {
    notify(`"${ds.name}" is a table without geometry, so it cannot be drawn on a map.`, 'warning');
    return;
  }
  const mapId = ensureActiveMap();
  addDatasetToMap(ds, mapId);
  void zoomToExtentWhenReady(mapId, datasetExtent(ds.id));
}

async function deleteDataset(ds: Dataset) {
  const maps = useProject.getState().project.maps;
  const usage = datasetUsage(ds.id, maps);
  const message = usage.length
    ? `"${ds.name}" is used by ${usage.length} layer${usage.length === 1 ? '' : 's'} (${usage.slice(0, 4).map((u) => `${u.layerName} in ${u.mapName}`).join(', ')}${usage.length > 4 ? ', …' : ''}). Deleting the dataset removes ${usage.length === 1 ? 'that layer' : 'those layers'} too. This cannot be undone.`
    : `Delete "${ds.name}" (${ds.features.length.toLocaleString()} features)? This cannot be undone.`;
  if (!(await confirmDialog({ title: 'Delete dataset', message, confirmLabel: 'Delete', danger: true }))) return;
  for (const u of usage) removeLayer(u.layerId);
  removeDataset(ds.id);
}

async function renameItem(item: Item) {
  const name = await promptDialog({ title: `Rename ${item.section === 'data' ? 'dataset' : item.section.slice(0, -1)}`, label: 'Name', value: item.name, confirmLabel: 'Rename' });
  if (!name || name === item.name) return;
  if (item.section === 'maps') updateMap(item.id, { name });
  else if (item.section === 'layouts') updateLayout(item.id, (l) => void (l.name = name));
  else if (item.section === 'charts') updateChart(item.id, (c) => void (c.name = name));
  else renameDataset(item.id, name);
}

async function deleteItem(item: Item) {
  const label = item.section === 'maps' ? 'map' : item.section === 'layouts' ? 'layout' : 'chart';
  if (!(await confirmDialog({ title: `Delete ${label}`, message: `Delete the ${label} "${item.name}"? This cannot be undone.`, confirmLabel: 'Delete', danger: true }))) return;
  if (item.section === 'maps') {
    removeMap(item.id);
    if (!getProject().maps.length) openView('map', addMap().id); // never leave the project without a map
  } else if (item.section === 'layouts') removeLayout(item.id);
  else removeChart(item.id);
}

function openItem(item: Item, datasets: Dataset[]) {
  if (item.section === 'maps') openView('map', item.id);
  else if (item.section === 'layouts') openView('layout', item.id);
  else if (item.section === 'charts') openView('chart', item.id);
  else {
    const ds = datasets.find((d) => d.id === item.id);
    if (ds) addDatasetToActiveMap(ds);
  }
}

function menuFor(item: Item, datasets: Dataset[]): MenuItem[] {
  if (item.section === 'data') {
    const ds = datasets.find((d) => d.id === item.id);
    if (!ds) return [];
    return [
      { label: 'Add to current map', icon: <MapPlus />, disabled: !ds.geomType, onClick: () => addDatasetToActiveMap(ds) },
      { label: 'Export features…', icon: <Download />, disabled: !ds.geomType, onClick: () => exportDataset(ds) },
      'separator',
      { label: 'Rename…', icon: <Pencil />, onClick: () => void renameItem(item) },
      { label: 'Properties…', icon: <Info />, onClick: () => openDialog('io.dataset-properties', { datasetId: ds.id }) },
      'separator',
      { label: 'Delete…', icon: <Trash2 />, danger: true, onClick: () => void deleteDataset(ds) },
    ];
  }
  return [
    { label: 'Open', icon: <FolderOpen />, onClick: () => openItem(item, datasets) },
    { label: 'Rename…', icon: <Pencil />, onClick: () => void renameItem(item) },
    'separator',
    { label: 'Delete…', icon: <Trash2 />, danger: true, onClick: () => void deleteItem(item) },
  ];
}

function exportDataset(ds: Dataset) {
  // find a layer that shows the dataset so the dialog can honour selection and definition query
  const layer = useProject.getState().project.maps.flatMap((m) => m.layers).find((l) => l.kind === 'feature' && l.datasetId === ds.id);
  if (layer) openDialog('io.export', { layerId: layer.id });
  else notify('Add the dataset to a map first, then export its layer.', 'info');
}

// ---------- component ----------

export function CatalogPane() {
  const maps = useProject((s) => s.project.maps);
  const layouts = useProject((s) => s.project.layouts);
  const charts = useProject((s) => s.project.charts);
  const projectName = useProject((s) => s.project.name);
  const datasets = useAllDatasets();
  const activeMapId = useUi((s) => s.activeMapId);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const sections = useMemo(() => {
    const usage = new Map<Id, number>();
    for (const m of maps) for (const l of m.layers) if (l.kind === 'feature') usage.set(l.datasetId, (usage.get(l.datasetId) ?? 0) + 1);
    const q = query.trim().toLowerCase();
    const match = (i: Item) => !q || i.name.toLowerCase().includes(q) || (i.meta ?? '').toLowerCase().includes(q);
    const list: Array<{ id: Section; title: string; icon: LucideIcon; items: Item[]; total: number }> = [
      { id: 'maps', title: 'Maps', icon: MapIcon, total: maps.length, items: maps.map((m): Item => ({ key: `maps:${m.id}`, section: 'maps', id: m.id, name: m.name, icon: MapIcon, meta: `${m.layers.filter((l) => l.kind !== 'group').length} layers` })) },
      { id: 'layouts', title: 'Layouts', icon: LayoutTemplate, total: layouts.length, items: layouts.map((l): Item => ({ key: `layouts:${l.id}`, section: 'layouts', id: l.id, name: l.name, icon: LayoutTemplate, meta: `${l.page.width} x ${l.page.height} mm` })) },
      { id: 'charts', title: 'Charts', icon: ChartColumn, total: charts.length, items: charts.map((c): Item => ({ key: `charts:${c.id}`, section: 'charts', id: c.id, name: c.name, icon: ChartColumn })) },
      {
        id: 'data', title: 'Data', icon: Database, total: datasets.length,
        items: datasets.map((d): Item => ({
          key: `data:${d.id}`, section: 'data', id: d.id, name: d.name, icon: d.geomType ? GEOM_ICON[d.geomType] : Table2,
          meta: `${d.features.length.toLocaleString()}`,
          title: `${d.name}\n${d.geomType ? GEOM_NAME[d.geomType] : 'Table'}, ${d.features.length.toLocaleString()} features\nSource: ${d.source ?? 'unknown'}${usage.get(d.id) ? `\nUsed by ${usage.get(d.id)} layer(s)` : '\nNot used in any map'}`,
        })),
      },
    ];
    return list.map((s) => ({ ...s, items: s.items.filter(match) }));
  }, [maps, layouts, charts, datasets, query]);

  const searching = !!query.trim();
  const empty = datasets.length + maps.length + layouts.length + charts.length === 0;

  return (
    <>
      <div className="pane-toolbar cat-toolbar">
        <Button variant="primary" icon={Plus} onClick={() => void runCommand('data.add')}>
          Add Data
        </Button>
        <IconButton icon={MapPlus} title="New map" onClick={() => void runCommand('map.new')} />
        <IconButton icon={Upload} title="Add data from files" onClick={() => void runCommand('data.addFiles')} />
        <span className="grow" />
      </div>
      <div className="cat-search">
        <Search size={13} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the project" spellCheck={false} />
        {query && <IconButton icon={X} title="Clear search" onClick={() => setQuery('')} />}
      </div>
      <div className="pane-body cat-tree" role="tree" aria-label={`Catalog of ${projectName}`}>
        {empty && <Empty icon={Database} title="Nothing here yet">Drop files onto the window or use Add Data to start.</Empty>}
        {!empty &&
          sections.map((s) => {
            if (searching && s.items.length === 0) return null;
            const open = searching || !collapsed[s.id];
            return (
              <div key={s.id} className="cat-section">
                <button type="button" className="cat-head" aria-expanded={open} onClick={() => setCollapsed((c) => ({ ...c, [s.id]: !c[s.id] }))}>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <s.icon size={14} />
                  <span className="grow">{s.title}</span>
                  <span className="cat-count">{s.total}</span>
                </button>
                {open && s.items.length === 0 && <div className="cat-none">{s.id === 'data' ? 'No datasets' : `No ${s.title.toLowerCase()}`}</div>}
                {open &&
                  s.items.map((it) => (
                    <div
                      key={it.key}
                      role="treeitem"
                      aria-selected={selected === it.key}
                      tabIndex={0}
                      className={cx('cat-item', selected === it.key && 'sel', it.section === 'maps' && it.id === activeMapId && 'current')}
                      title={it.title ?? it.name}
                      onClick={() => setSelected(it.key)}
                      onDoubleClick={() => openItem(it, datasets)}
                      onContextMenu={(e) => {
                        setSelected(it.key);
                        showContextMenu(e, menuFor(it, datasets));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') openItem(it, datasets);
                        else if (e.key === 'F2') void renameItem(it);
                        else if (e.key === 'Delete') void (it.section === 'data' ? deleteDataset(datasets.find((d) => d.id === it.id)!) : deleteItem(it));
                      }}
                    >
                      <it.icon size={14} className="cat-icon" />
                      <span className="cat-name">{it.name}</span>
                      {it.meta && <span className="cat-meta">{it.meta}</span>}
                    </div>
                  ))}
              </div>
            );
          })}
        {!empty && searching && sections.every((s) => s.items.length === 0) && <Empty icon={Search} title="No matches" />}
      </div>
      <div className="pane-footer cat-foot">
        <span className="muted">Double-click to open a view or add data to the map. Drop files here to import.</span>
      </div>
    </>
  );
}
