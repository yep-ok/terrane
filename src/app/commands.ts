// Core registrations owned by the shell: ribbon tabs, app-level commands, the map view type.
import { Map as MapIcon, Moon, PanelsTopLeft, Redo2, Undo2 } from 'lucide-react';
import {
  allPanes, registerCommand, registerRibbonGroup, registerRibbonTab, registerView, togglePane, openPane,
} from '../core/registry';
import { redo, undo, canRedo, canUndo } from '../core/history';
import { addMap, findLayer, getMap } from '../core/store';
import { isPaneOpen, openView, setTheme, useUi } from '../core/ui';
import { MapView } from '../map/MapView';

export function registerCore() {
  registerRibbonTab({ id: 'project', title: 'Project', order: 0 });
  registerRibbonTab({ id: 'map', title: 'Map', order: 10 });
  registerRibbonTab({ id: 'insert', title: 'Insert', order: 20 });
  registerRibbonTab({ id: 'analysis', title: 'Analysis', order: 30 });
  registerRibbonTab({ id: 'view', title: 'View', order: 40 });
  registerRibbonTab({ id: 'edit', title: 'Edit', order: 50 });
  registerRibbonTab({ id: 'share', title: 'Share', order: 60 });
  registerRibbonTab({
    id: 'layer', title: 'Feature Layer', order: 100, contextual: true,
    visible: () => findLayer(useUi.getState().activeLayerId)?.layer.kind === 'feature',
  });
  registerRibbonTab({
    id: 'layout', title: 'Layout', order: 110, contextual: true,
    visible: () => {
      const s = useUi.getState();
      return s.views.find((v) => v.id === s.activeViewId)?.type === 'layout';
    },
  });

  registerView({ type: 'map', component: MapView, icon: MapIcon, title: (id) => getMap(id)?.name ?? 'Map' });

  registerCommand({ id: 'app.undo', title: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z', run: undo, enabled: canUndo });
  registerCommand({ id: 'app.redo', title: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y', run: redo, enabled: canRedo });
  registerCommand({
    id: 'app.theme', title: 'Toggle Dark Theme', icon: Moon, keywords: 'light dark appearance',
    run: () => setTheme(useUi.getState().theme === 'dark' ? 'light' : 'dark'),
    active: () => useUi.getState().theme === 'dark',
  });
  registerCommand({
    id: 'map.new', title: 'New Map', icon: MapIcon, description: 'Add a new map to the project and open it.',
    run: () => {
      const m = addMap();
      openView('map', m.id);
    },
  });
}

/** Call after all feature modules registered: builds `pane.<id>` toggle commands and the View > Windows group. */
export function registerPaneCommands() {
  for (const p of allPanes()) {
    registerCommand({
      id: `pane.${p.id}`, title: p.title, icon: p.icon ?? PanelsTopLeft, keywords: 'pane window show',
      description: `Show or hide the ${p.title} pane.`,
      run: () => togglePane(p.id),
      active: () => isPaneOpen(p.id),
    });
  }
  const ids = allPanes().map((p) => `pane.${p.id}`);
  const stacks = [];
  for (let i = 0; i < ids.length; i += 3) stacks.push({ type: 'stack' as const, items: ids.slice(i, i + 3).map((command) => ({ type: 'button' as const, command, size: 'small' as const })) });
  registerRibbonGroup({ tab: 'view', id: 'windows', title: 'Windows', order: 10, items: stacks });
  registerRibbonGroup({
    tab: 'view', id: 'appearance', title: 'Appearance', order: 90,
    items: [{ type: 'button', command: 'app.theme', label: 'Dark Theme' }],
  });
  registerCommand({
    id: 'app.resetPanes', title: 'Reset Panes', icon: PanelsTopLeft, description: 'Restore the default pane arrangement.',
    run: () => {
      for (const id of ['catalog', 'contents']) if (allPanes().some((p) => p.id === id)) openPane(id);
    },
  });
}
