// Contents commands. Layer commands take an optional layerId (default: the multi-selection
// containing the active layer, else the active layer); map commands take an optional mapId.
import {
  ArrowDown, ArrowUp, Copy, Eye, EyeOff, FolderPlus, Group, Layers, Pencil, Settings2, Trash, Ungroup, ZoomIn,
} from 'lucide-react';
import type { Id } from '../../core/types';
import { uid } from '../../core/data';
import { pushUndo } from '../../core/history';
import { addMap, findLayer, getMap, getProject, removeMap, updateLayer } from '../../core/store';
import { activeLayerId, activeMapId, notify, openDialog, openView, pruneViews } from '../../core/ui';
import { openPane, registerCommand } from '../../core/registry';
import { cloneLayers, copyName } from './tree';
import { cui } from './state';
import {
  addGroup, duplicateLayers, groupLayers, moveSibling, removeLayers, showOnly, targetIds, ungroup, zoomToLayer,
} from './actions';

const hasLayer = () => !!findLayer(activeLayerId());
const mapIdOf = (arg?: any): Id | undefined => (typeof arg === 'string' ? arg : arg?.mapId ?? activeMapId() ?? undefined);

/** Run fn for the single target layer, or tell the user to pick one. */
function withTarget(arg: any, fn: (id: Id) => void) {
  const id = targetIds(arg)[0];
  if (!id) return void notify('Select a layer in Contents first.', 'info');
  fn(id);
}

export function registerCommands() {
  registerCommand({
    id: 'layer.zoomTo', title: 'Zoom To Layer', icon: ZoomIn, description: 'Zoom the map to the extent of the layer',
    keywords: 'extent fit', enabled: hasLayer, run: (arg) => withTarget(arg, zoomToLayer),
  });
  registerCommand({
    id: 'layer.remove', title: 'Remove Layer', icon: Trash, description: 'Remove the selected layers from the map (the data stays in the project until saved)',
    keywords: 'delete', enabled: hasLayer,
    run: (arg) => {
      const ids = targetIds(arg);
      if (!ids.length) return void notify('Select a layer in Contents first.', 'info');
      removeLayers(ids);
    },
  });
  registerCommand({
    id: 'layer.rename', title: 'Rename Layer', icon: Pencil, description: 'Rename the layer in Contents', enabled: hasLayer,
    run: (arg) =>
      withTarget(arg, (id) => {
        openPane('contents');
        cui({ renamingId: id, renamingMap: false });
      }),
  });
  registerCommand({
    id: 'layer.duplicate', title: 'Duplicate Layer', icon: Copy, description: 'Create a copy of the layer with the same symbology and settings', enabled: hasLayer,
    run: (arg) => {
      const ids = targetIds(arg);
      if (!ids.length) return void notify('Select a layer in Contents first.', 'info');
      duplicateLayers(ids);
    },
  });
  registerCommand({
    id: 'layer.properties', title: 'Layer Properties', icon: Settings2, description: 'Name, visibility range, definition query, pop-ups and more', keywords: 'settings',
    enabled: hasLayer,
    run: (arg) => withTarget(arg, (layerId) => openDialog('layer-properties', { layerId, tab: typeof arg === 'object' ? arg?.tab : undefined })),
  });
  registerCommand({
    id: 'layer.addGroup', title: 'Group Layer', icon: FolderPlus, description: 'Add an empty group layer to the active map', keywords: 'folder new',
    enabled: () => !!activeMapId(), run: () => void addGroup(),
  });
  registerCommand({
    id: 'layer.group', title: 'Group Selected Layers', icon: Group, description: 'Move the selected layers into a new group layer', enabled: hasLayer,
    run: (arg) => {
      const ids = targetIds(arg);
      if (!ids.length) return void notify('Select one or more layers in Contents first.', 'info');
      groupLayers(ids);
    },
  });
  registerCommand({
    id: 'layer.ungroup', title: 'Ungroup', icon: Ungroup, description: 'Dissolve a group layer, keeping its layers', enabled: hasLayer,
    run: (arg) => withTarget(arg, ungroup),
  });
  registerCommand({
    id: 'layer.toggleVisibility', title: 'Toggle Layer Visibility', icon: Eye, description: 'Show or hide the selected layers', enabled: hasLayer,
    run: (arg) => {
      const ids = targetIds(arg);
      if (!ids.length) return void notify('Select a layer in Contents first.', 'info');
      const on = !(findLayer(ids[0])?.layer.visible ?? true);
      for (const id of ids) updateLayer(id, { visible: on });
    },
  });
  registerCommand({
    id: 'layer.moveUp', title: 'Move Layer Up', icon: ArrowUp, description: 'Draw the layer above its neighbour', enabled: hasLayer,
    run: (arg) => withTarget(arg, (id) => moveSibling(id, 'up')),
  });
  registerCommand({
    id: 'layer.moveDown', title: 'Move Layer Down', icon: ArrowDown, description: 'Draw the layer below its neighbour', enabled: hasLayer,
    run: (arg) => withTarget(arg, (id) => moveSibling(id, 'down')),
  });
  registerCommand({
    id: 'layer.only-visible', title: 'Show Only This Layer', icon: EyeOff, description: 'Switch off every other layer in the map', keywords: 'isolate solo', enabled: hasLayer,
    run: (arg) => withTarget(arg, showOnly),
  });

  // ----- map commands -----
  registerCommand({
    id: 'map.properties', title: 'Map Properties', icon: Settings2, description: 'Name, coordinate system, rotation, basemap and layer statistics',
    enabled: () => !!activeMapId(),
    run: (arg) => {
      const mapId = mapIdOf(arg);
      if (!mapId || !getMap(mapId)) return void notify('Open a map first.', 'warning');
      openDialog('map-properties', { mapId });
    },
  });
  registerCommand({
    id: 'map.rename', title: 'Rename Map', icon: Pencil, description: 'Rename the active map', enabled: () => !!activeMapId(),
    run: () => {
      if (!activeMapId()) return void notify('Open a map first.', 'warning');
      openPane('contents');
      cui({ renamingMap: true, renamingId: null });
    },
  });
  registerCommand({
    id: 'map.duplicate', title: 'Duplicate Map', icon: Layers, description: 'Create a copy of the map with all its layers', enabled: () => !!activeMapId(),
    run: (arg) => {
      const src = getMap(mapIdOf(arg));
      if (!src) return void notify('Open a map first.', 'warning');
      const layers = cloneLayers(src.layers, (l) => uid(l.kind === 'group' ? 'grp' : 'lyr'));
      const name = copyName(src.name, getProject().maps.map((m) => m.name));
      const copy = addMap({
        name, layers, basemap: src.basemap, crs: src.crs, view: { ...src.view, center: [...src.view.center] as [number, number] },
        bookmarks: src.bookmarks.map((b) => ({ ...b, id: uid('bm'), center: [...b.center] as [number, number] })),
      });
      pushUndo({ label: 'Duplicate map', undo: () => { removeMap(copy.id); pruneViews(); }, redo: () => void addMap(copy) });
      openView('map', copy.id);
    },
  });
  registerCommand({
    id: 'map.remove', title: 'Remove Map', icon: Trash, description: 'Remove the map (asks for confirmation)', enabled: () => !!activeMapId(),
    run: (arg) => {
      const map = getMap(mapIdOf(arg));
      if (!map) return void notify('Open a map first.', 'warning');
      openDialog('contents-confirm', {
        title: 'Remove map',
        message: `Remove the map "${map.name}" and its ${map.layers.length} layer${map.layers.length === 1 ? '' : 's'}? Charts based on this map are removed too. The project's data is kept.`,
        confirmLabel: 'Remove map',
        danger: true,
        onConfirm: () => {
          removeMap(map.id);
          pruneViews();
        },
      });
    },
  });
}
