// Context menus for the Contents pane. Entries that run another module's command are
// hidden when that command is not registered.
import type { LucideIcon } from 'lucide-react';
import {
  ArrowDown, ArrowUp, ChartColumn, ChevronsDownUp, ChevronsUpDown, Copy, Database, Download, Eye, EyeOff, FolderPlus,
  Group, Layers, MousePointerClick, Pencil, Plus, Settings2, Table2, Tag, Trash, Ungroup, ZoomIn, Palette, SquareMousePointer,
} from 'lucide-react';
import type { Id, Layer } from '../../core/types';
import { updateLayer } from '../../core/store';
import { getCommand, runCommand } from '../../core/registry';
import { getSelection, type MenuItem } from '../../core/ui';
import {
  onlySelectable, setAllExpanded, setAllVisible, targetIds, zoomToLayer, zoomToSelection,
} from './actions';

const ico = (I: LucideIcon) => <I />;

/** Menu entry that runs a registered command (null when the command does not exist). */
function cmd(id: string, label: string, icon?: LucideIcon, arg?: any): MenuItem | null {
  const c = getCommand(id);
  if (!c) return null;
  return { label, icon: icon ? ico(icon) : undefined, disabled: c.enabled ? !c.enabled() : false, onClick: () => void runCommand(id, arg) };
}

const danger = (m: MenuItem | null): MenuItem | null => (m && m !== 'separator' ? { ...m, danger: true } : m);

const item = (label: string, onClick: () => void, icon?: LucideIcon, extra: Partial<Exclude<MenuItem, string>> = {}): MenuItem => ({
  label, onClick, icon: icon ? ico(icon) : undefined, ...extra,
});

/** Drop nulls, collapse duplicate/leading/trailing separators, drop empty submenus. */
export function tidy(items: Array<MenuItem | null | false | undefined>): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it) continue;
    if (it !== 'separator' && it.submenu) {
      const sub = tidy(it.submenu);
      if (!sub.length) continue;
      out.push({ ...it, submenu: sub });
      continue;
    }
    if (it === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue;
    out.push(it);
  }
  while (out[out.length - 1] === 'separator') out.pop();
  return out;
}

export function layerMenu(layer: Layer): MenuItem[] {
  const id = layer.id;
  const multi = targetIds().length > 1 && targetIds().includes(id);
  const sep: MenuItem = 'separator';

  if (multi) {
    const ids = targetIds();
    return tidy([
      item('Show all selected', () => ids.forEach((x) => updateLayer(x, { visible: true })), Eye),
      item('Hide all selected', () => ids.forEach((x) => updateLayer(x, { visible: false })), EyeOff),
      sep,
      cmd('layer.group', 'Group', Group),
      cmd('layer.duplicate', 'Duplicate', Copy),
      sep,
      danger(cmd('layer.remove', 'Remove', Trash)),
    ]);
  }

  if (layer.kind === 'group') {
    return tidy([
      item('Zoom To Group', () => zoomToLayer(id), ZoomIn),
      sep,
      cmd('layer.rename', 'Rename', Pencil, id),
      cmd('layer.addGroup', 'New Group Inside', FolderPlus, id),
      cmd('layer.ungroup', 'Ungroup', Ungroup, id),
      item(layer.visible ? 'Hide' : 'Show', () => updateLayer(id, { visible: !layer.visible }), layer.visible ? EyeOff : Eye),
      item(layer.expanded ? 'Collapse' : 'Expand', () => updateLayer(id, { expanded: !layer.expanded }), layer.expanded ? ChevronsDownUp : ChevronsUpDown),
      sep,
      cmd('layer.duplicate', 'Duplicate', Copy, id),
      cmd('layer.moveUp', 'Move Up', ArrowUp, id),
      cmd('layer.moveDown', 'Move Down', ArrowDown, id),
      sep,
      danger(cmd('layer.remove', 'Remove', Trash, id)),
      sep,
      cmd('layer.properties', 'Properties…', Settings2, id),
    ]);
  }

  if (layer.kind === 'feature') {
    const selCount = getSelection(id).length;
    return tidy([
      item('Zoom To Layer', () => zoomToLayer(id), ZoomIn),
      selCount > 0 && item('Zoom To Selection', () => zoomToSelection(id), SquareMousePointer),
      sep,
      cmd('layer.table', 'Attribute Table', Table2, id),
      cmd('layer.symbology', 'Symbology', Palette, id),
      cmd('layer.labeling', 'Labeling', Tag, id),
      item('Show Labels', () => updateLayer(id, { labels: { ...layer.labels, enabled: !layer.labels.enabled } }), Tag, { checked: layer.labels.enabled }),
      sep,
      {
        label: 'Selection',
        icon: ico(MousePointerClick),
        submenu: tidy([
          cmd('select.all', 'Select All', undefined, id),
          cmd('select.clear', 'Clear Selection', undefined, id),
          sep,
          item('Make This the Only Selectable Layer', () => onlySelectable(id)),
          item('Selectable', () => updateLayer(id, { selectable: !layer.selectable }), undefined, { checked: layer.selectable }),
        ]),
      },
      {
        label: 'Data',
        icon: ico(Database),
        submenu: tidy([
          cmd('layer.export', 'Export Features…', Download, id),
          cmd('layer.fields', 'Fields…', undefined, id),
          cmd('chart.new', 'Create Chart…', ChartColumn, id),
        ]),
      },
      sep,
      cmd('layer.group', 'Group', Group, id),
      cmd('layer.duplicate', 'Duplicate', Copy, id),
      cmd('layer.rename', 'Rename', Pencil, id),
      cmd('layer.only-visible', 'Show Only This Layer', Eye, id),
      danger(cmd('layer.remove', 'Remove', Trash, id)),
      sep,
      cmd('layer.properties', 'Properties…', Settings2, id),
    ]);
  }

  // tile / raster
  return tidy([
    item('Zoom To Layer', () => zoomToLayer(id), ZoomIn, { disabled: layer.kind === 'tile' }),
    sep,
    cmd('layer.rename', 'Rename', Pencil, id),
    cmd('layer.group', 'Group', Group, id),
    cmd('layer.duplicate', 'Duplicate', Copy, id),
    cmd('layer.only-visible', 'Show Only This Layer', Eye, id),
    sep,
    danger(cmd('layer.remove', 'Remove', Trash, id)),
    sep,
    cmd('layer.properties', 'Properties…', Settings2, id),
  ]);
}

/** Menu for the map header and the empty area of the pane. */
export function mapMenu(mapId: Id, opts: { header?: boolean } = {}): MenuItem[] {
  const sep: MenuItem = 'separator';
  return tidy([
    cmd('data.add', 'Add Data…', Plus),
    cmd('layer.addGroup', 'New Group Layer', FolderPlus),
    sep,
    item('Turn All Layers On', () => setAllVisible(mapId, true), Eye),
    item('Turn All Layers Off', () => setAllVisible(mapId, false), EyeOff),
    item('Expand All Groups', () => setAllExpanded(mapId, true), ChevronsUpDown),
    item('Collapse All Groups', () => setAllExpanded(mapId, false), ChevronsDownUp),
    sep,
    opts.header && cmd('map.rename', 'Rename Map', Pencil, mapId),
    opts.header && cmd('map.duplicate', 'Duplicate Map', Layers, mapId),
    opts.header && cmd('map.remove', 'Remove Map…', Trash, mapId),
    opts.header && sep,
    cmd('map.properties', 'Map Properties…', Settings2, mapId),
  ]);
}

