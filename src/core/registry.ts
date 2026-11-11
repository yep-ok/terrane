// Extension points. Feature modules register commands, ribbon groups, panes,
// dialogs and map tools from their `register()` function (called once at startup).
import type { ComponentType, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { MapHandle } from '../map/handle';
import { hidePane, isPaneOpen, notify, setTool, showPaneIn, useUi, type DockSide } from './ui';

// ---------- commands ----------

export interface Command {
  id: string; // 'namespace.verb', e.g. 'map.zoomFull'
  title: string;
  icon?: LucideIcon;
  /** Tooltip / command-search description. */
  description?: string;
  keywords?: string;
  /** e.g. 'Ctrl+Z', 'Ctrl+Shift+S', 'Delete', 'F2'. Handled globally unless focus is in a text input. */
  shortcut?: string;
  run(arg?: any): void | Promise<void>;
  /** Evaluated on render; defaults to true. */
  enabled?(): boolean;
  /** For toggle-style commands (pane open, tool active). */
  active?(): boolean;
}

const commands = new Map<string, Command>();
export function registerCommand(cmd: Command) {
  commands.set(cmd.id, cmd);
}
export const getCommand = (id: string) => commands.get(id);
export const allCommands = () => [...commands.values()];
export async function runCommand(id: string, arg?: any) {
  const cmd = commands.get(id);
  if (!cmd) return notify(`Unknown command: ${id}`, 'error');
  if (cmd.enabled && !cmd.enabled()) return;
  try {
    await cmd.run(arg);
  } catch (err: any) {
    console.error(err);
    notify(`${cmd.title}: ${err?.message ?? err}`, 'error');
  }
}

// ---------- ribbon ----------

export interface RibbonTab {
  id: string;
  title: string;
  order: number;
  /** Contextual tabs are only shown while this returns true. */
  visible?(): boolean;
  contextual?: boolean;
}
export type RibbonMenuEntry = string | 'separator' | { command: string; label?: string; arg?: any };
export type RibbonItem =
  | { type: 'button'; command: string; size?: 'large' | 'small'; label?: string; arg?: any }
  | { type: 'menu'; label: string; icon: LucideIcon; size?: 'large' | 'small'; items: RibbonMenuEntry[] | (() => RibbonMenuEntry[]) }
  /** Split button: clicking the face runs `command`, the arrow opens the menu. */
  | { type: 'split'; command: string; size?: 'large' | 'small'; label?: string; items: RibbonMenuEntry[] | (() => RibbonMenuEntry[]) }
  | { type: 'custom'; render: () => ReactNode }
  /** Small items stacked vertically (max 3). */
  | { type: 'stack'; items: RibbonItem[] };
export interface RibbonGroup {
  tab: string;
  id: string;
  title: string;
  order: number;
  items: RibbonItem[];
}

const tabs = new Map<string, RibbonTab>();
const groups: RibbonGroup[] = [];
export function registerRibbonTab(tab: RibbonTab) {
  tabs.set(tab.id, tab);
}
export function registerRibbonGroup(group: RibbonGroup) {
  const i = groups.findIndex((g) => g.tab === group.tab && g.id === group.id);
  if (i >= 0) groups[i] = group;
  else groups.push(group);
}
export const ribbonTabs = () => [...tabs.values()].sort((a, b) => a.order - b.order);
export const ribbonGroups = (tab: string) => groups.filter((g) => g.tab === tab).sort((a, b) => a.order - b.order);

// ---------- panes ----------

export interface PaneDef {
  id: string;
  title: string;
  icon?: LucideIcon;
  dock: DockSide;
  component: ComponentType<{ props?: any }>;
}
const panes = new Map<string, PaneDef>();
export function registerPane(pane: PaneDef) {
  panes.set(pane.id, pane);
}
export const getPane = (id: string) => panes.get(id);
export const allPanes = () => [...panes.values()];
/** Open (or bring to front) a registered pane, optionally passing props to it. */
export function openPane(id: string, props?: any) {
  const p = panes.get(id);
  if (!p) return notify(`Unknown pane: ${id}`, 'error');
  showPaneIn(p.dock, id, props);
}
export const closePane = hidePane;
export const togglePane = (id: string) => (isPaneOpen(id) ? hidePane(id) : openPane(id));

// ---------- dialogs ----------

export interface DialogDef {
  id: string;
  title: string | ((props: any) => string);
  width?: number;
  component: ComponentType<{ props: any; close: () => void }>;
}
const dialogs = new Map<string, DialogDef>();
export function registerDialog(d: DialogDef) {
  dialogs.set(d.id, d);
}
export const getDialog = (id: string) => dialogs.get(id);

// ---------- map tools ----------

export interface MapTool {
  id: string;
  title: string;
  icon?: LucideIcon;
  /** CSS cursor applied to the map viewport while active. */
  cursor?: string;
  /** Called when the tool becomes active on a map; return a cleanup function. */
  activate(handle: MapHandle): void | (() => void);
}
const tools = new Map<string, MapTool>();
/** Registers the tool and a toggle command `tool.<id>` (usable as a ribbon button) that activates it. */
export function registerMapTool(tool: MapTool, command: Partial<Command> = {}) {
  tools.set(tool.id, tool);
  registerCommand({
    id: `tool.${tool.id}`,
    title: tool.title,
    icon: tool.icon,
    run: () => setTool(tool.id),
    active: () => useUi.getState().activeTool === tool.id,
    enabled: () => !!useUi.getState().activeMapId,
    ...command,
  });
}
export const getMapTool = (id: string) => tools.get(id);
export const allMapTools = () => [...tools.values()];

/**
 * Map plugins run once for every interactive map view when it is created (e.g. to
 * attach always-on listeners such as a right-click menu). Return a cleanup function.
 */
export type MapPlugin = (handle: MapHandle) => void | (() => void);
const mapPlugins: MapPlugin[] = [];
export function registerMapPlugin(plugin: MapPlugin) {
  mapPlugins.push(plugin);
}
export const allMapPlugins = () => mapPlugins;

// ---------- view types (center area) ----------

export interface ViewDef {
  type: string; // 'map' | 'layout' | 'chart'
  component: ComponentType<{ refId: string; active: boolean }>;
  icon?: LucideIcon;
  title(refId: string): string;
}
const viewDefs = new Map<string, ViewDef>();
export function registerView(def: ViewDef) {
  viewDefs.set(def.type, def);
}
export const getViewDef = (type: string) => viewDefs.get(type);
