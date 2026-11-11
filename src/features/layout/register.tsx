// layout module entry point: view, pane, dialogs, commands and ribbon.
import { useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal,
  AlignStartVertical, AlignVerticalDistributeCenter, ArrowDownToLine, ArrowUpToLine, ChevronDown, ChevronsDown, ChevronsUp, Compass,
  Copy, CopyPlus, FileDown, FileImage, FileText, Frame, Grid3x3, ImagePlus, LayoutTemplate, ListTree, Lock, Magnet, Map as MapIcon,
  Maximize, Pencil, Printer, Ruler, SquareDashed, Square, Trash, Type, PanelTop, type LucideIcon,
} from 'lucide-react';
import type { Id, LayoutDoc } from '../../core/types';
import { uid } from '../../core/data';
import { addLayout, getLayout, getMap, getProject, removeLayout } from '../../core/store';
import { openDialog, openView, pruneViews, notify, useUi, type MenuItem } from '../../core/ui';
import { pushUndo } from '../../core/history';
import { getCommand, openPane, registerCommand, registerDialog, registerPane, registerRibbonGroup, registerView, runCommand } from '../../core/registry';
import { Button, Row, TextInput, cx, openMenuAt } from '../../ui/kit';
import { LayoutView } from './LayoutView';
import { LayoutElementPane } from './Pane';
import { ExportLayoutDialog } from './ExportDialog';
import { printLayout } from './exporter';
import { defaultComposition } from './elements';
import {
  activeLayoutId, getSelectionIds, selectedElements, setSelectionIds, setSessionFlag, useLayoutSession, editLayout,
} from './session';
import {
  align, deleteSelection, distribute, duplicateSelection, insertElement, reorder, setLocked, zoomActual, zoomToPage,
} from './actions';
import type { AlignMode } from './geometry';
import './layout.css';

const hasLayout = () => !!activeLayoutId();
const withLayout = (fn: (id: Id) => void) => () => {
  const id = activeLayoutId();
  if (!id) return notify('Open a layout view first.', 'info');
  fn(id);
};
const hasSelection = () => {
  const id = activeLayoutId();
  return !!id && getSelectionIds(id).length > 0;
};

// ---------- layout documents ----------

function cloneLayoutDoc(src: LayoutDoc, name: string): LayoutDoc {
  const copy: LayoutDoc = JSON.parse(JSON.stringify(src));
  copy.id = uid('lay');
  copy.name = name;
  const ids = new Map<Id, Id>();
  for (const e of copy.elements) {
    const nid = uid('el');
    ids.set(e.id, nid);
    e.id = nid;
  }
  for (const e of copy.elements) if (e.props.frameId) e.props.frameId = ids.get(e.props.frameId) ?? '';
  return copy;
}

function uniqueLayoutName(base: string) {
  const taken = new Set(getProject().layouts.map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Add a layout document with an undo entry that removes it again. */
function addLayoutUndoable(doc: Partial<LayoutDoc>, label: string): LayoutDoc {
  const created = addLayout(doc);
  const snap = getLayout(created.id)!;
  pushUndo({
    label,
    undo: () => {
      removeLayout(snap.id);
      pruneViews();
    },
    redo: () => void addLayout(snap),
  });
  return created;
}

function newLayout(mapId?: Id) {
  const map = getMap(mapId ?? useUi.getState().activeMapId) ?? getProject().maps[0];
  const page = { width: 297, height: 210 };
  const name = uniqueLayoutName(map ? `${map.name} Layout` : 'Layout');
  const l = addLayoutUndoable({ name, page, elements: defaultComposition(map, page, 10), ...({ margin: 10 } as object) }, 'New Layout');
  openView('layout', l.id);
  openPane('layout-element');
  if (!map) notify('The project has no maps yet; insert a map frame once you have one.', 'info');
}

function deleteLayout(id: Id) {
  const snap = getLayout(id);
  if (!snap) return;
  removeLayout(id);
  pruneViews();
  pushUndo({ label: `Delete ${snap.name}`, undo: () => void addLayout(snap), redo: () => { removeLayout(id); pruneViews(); } });
  notify(`Deleted layout "${snap.name}". Undo (Ctrl+Z) restores it.`, 'info');
}

function RenameDialog({ props, close }: { props: { layoutId: Id }; close: () => void }) {
  const l = getLayout(props.layoutId);
  const [name, setName] = useState(l?.name ?? '');
  const ok = () => {
    const v = name.trim();
    if (v && l && v !== l.name) editLayout(l.id, 'Rename Layout', (d) => void (d.name = v));
    close();
  };
  return (
    <>
      <div className="dialog-body">
        <Row label="Name">
          <TextInput value={name} onChange={setName} autoFocus onFocus={(e) => e.target.select()} onKeyDown={(e) => e.key === 'Enter' && ok()} />
        </Row>
      </div>
      <div className="dialog-footer">
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!name.trim()} onClick={ok}>Rename</Button>
      </div>
    </>
  );
}

// ---------- reactive ribbon controls (the ribbon does not re-render on layout session changes) ----------

/** Re-render when toggles or the active layout's selection change (not on pan/zoom). */
const useRibbonTick = () =>
  useLayoutSession((s) => {
    const id = activeLayoutId();
    return `${s.rulers}|${s.guides}|${s.grid}|${s.snap}|${id ? s.views[id]?.selection.length ?? 0 : -1}`;
  });

function RbButton({ command, label, size = 'large', arg }: { command: string; label?: string; size?: 'large' | 'small'; arg?: any }) {
  useRibbonTick();
  const cmd = getCommand(command);
  if (!cmd) return null;
  const disabled = cmd.enabled ? !cmd.enabled() : false;
  const pressed = cmd.active?.() ?? false;
  const Icon = cmd.icon;
  return (
    <button type="button" className={cx('rb', size, pressed && 'pressed')} disabled={disabled} title={[cmd.title, cmd.description].filter(Boolean).join('\n')} onClick={() => runCommand(command, arg)}>
      {Icon && <Icon className="ico" />}
      <span>{label ?? cmd.title}</span>
    </button>
  );
}

function RbMenu({ label, icon: Icon, items, size = 'large', enabled }: { label: string; icon: LucideIcon; items: () => MenuItem[]; size?: 'large' | 'small'; enabled?: () => boolean }) {
  useRibbonTick();
  const disabled = enabled ? !enabled() : false;
  return (
    <button type="button" className={cx('rb', size)} disabled={disabled} title={label} onClick={(e) => openMenuAt(e.currentTarget, items())}>
      <Icon className="ico" />
      <span>
        {label}
        {size === 'large' && <ChevronDown className="chev" style={{ display: 'inline', marginLeft: 2, verticalAlign: -1 }} />}
      </span>
      {size === 'small' && <ChevronDown className="chev" />}
    </button>
  );
}

const stack = (...nodes: ReactNode[]) => <div className="rb-stack">{nodes}</div>;

const ALIGN: Array<{ mode: AlignMode; label: string; icon: LucideIcon }> = [
  { mode: 'left', label: 'Align Left', icon: AlignStartVertical },
  { mode: 'hcenter', label: 'Align Centre', icon: AlignCenterVertical },
  { mode: 'right', label: 'Align Right', icon: AlignEndVertical },
  { mode: 'top', label: 'Align Top', icon: AlignStartHorizontal },
  { mode: 'vcenter', label: 'Align Middle', icon: AlignCenterHorizontal },
  { mode: 'bottom', label: 'Align Bottom', icon: AlignEndHorizontal },
];

// ---------- registration ----------

export function register() {
  registerView({ type: 'layout', component: LayoutView, icon: LayoutTemplate, title: (id) => getLayout(id)?.name ?? 'Layout' });
  registerPane({ id: 'layout-element', title: 'Element', icon: Frame, dock: 'right', component: LayoutElementPane });
  registerDialog({ id: 'layout-export', title: 'Export Layout', width: 440, component: ExportLayoutDialog });
  registerDialog({ id: 'layout-rename', title: 'Rename Layout', width: 360, component: RenameDialog });

  // documents
  registerCommand({
    id: 'layout.new', title: 'New Layout', icon: LayoutTemplate, keywords: 'print page composition',
    description: 'Create a page layout for the active map with a title, legend, scale bar and north arrow.',
    run: (mapId?: Id) => newLayout(typeof mapId === 'string' ? mapId : undefined),
  });
  registerCommand({
    id: 'layout.open', title: 'Open Layout', icon: LayoutTemplate,
    run: (id?: Id) => {
      const l = getLayout(id) ?? getProject().layouts[0];
      if (l) openView('layout', l.id);
      else notify('The project has no layouts.', 'info');
    },
    enabled: () => getProject().layouts.length > 0,
  });
  registerCommand({
    id: 'layout.rename', title: 'Rename Layout', icon: Pencil,
    run: (id?: Id) => {
      const l = getLayout(id ?? activeLayoutId());
      if (l) openDialog('layout-rename', { layoutId: l.id });
    },
    enabled: hasLayout,
  });
  registerCommand({
    id: 'layout.delete', title: 'Delete Layout', icon: Trash, description: 'Remove the layout from the project (undoable).',
    run: (id?: Id) => {
      const l = getLayout(id ?? activeLayoutId());
      if (l) deleteLayout(l.id);
    },
    enabled: hasLayout,
  });
  registerCommand({
    id: 'layout.duplicate', title: 'Duplicate Layout', icon: Copy,
    run: (id?: Id) => {
      const l = getLayout(id ?? activeLayoutId());
      if (!l) return;
      const copy = addLayoutUndoable(cloneLayoutDoc(l, uniqueLayoutName(`${l.name} copy`)), 'Duplicate Layout');
      openView('layout', copy.id);
    },
    enabled: hasLayout,
  });

  // page / view
  registerCommand({
    id: 'layout.pageSetup', title: 'Page Setup', icon: PanelTop, description: 'Page size, orientation, margins and the element list.',
    run: withLayout((id) => {
      setSelectionIds(id, []);
      openPane('layout-element');
    }),
    enabled: hasLayout,
  });
  registerCommand({ id: 'layout.zoomToPage', title: 'Zoom To Page', icon: Maximize, run: withLayout(zoomToPage), enabled: hasLayout });
  registerCommand({ id: 'layout.zoom100', title: 'Zoom 100%', icon: Maximize, description: 'Show the page at actual size (96 dpi).', run: withLayout(zoomActual), enabled: hasLayout });
  const toggle = (id: string, title: string, icon: LucideIcon, key: 'rulers' | 'guides' | 'grid' | 'snap', description: string) =>
    registerCommand({
      id, title, icon, description,
      run: () => setSessionFlag(key, !useLayoutSession.getState()[key]),
      active: () => useLayoutSession.getState()[key],
      enabled: hasLayout,
    });
  toggle('layout.toggleRulers', 'Rulers', Ruler, 'rulers', 'Show or hide the page rulers.');
  toggle('layout.toggleGuides', 'Guides', SquareDashed, 'guides', 'Show or hide the margin guides.');
  toggle('layout.toggleGrid', 'Grid', Grid3x3, 'grid', 'Show the grid and snap elements to it.');
  toggle('layout.toggleSnap', 'Snapping', Magnet, 'snap', 'Snap elements to the page, margins and other elements.');

  // insert
  const ins = (id: string, title: string, icon: LucideIcon, type: Parameters<typeof insertElement>[1], description: string) =>
    registerCommand({ id, title, icon, description, run: (arg?: any) => withLayout((lid) => void insertElement(lid, type, arg))(), enabled: hasLayout });
  ins('layout.insertMap', 'Map Frame', MapIcon, 'map', 'Insert a map frame showing a project map.');
  ins('layout.insertText', 'Text', Type, 'text', 'Insert a text box. Tokens like {date} or {scale} update automatically.');
  ins('layout.insertLegend', 'Legend', ListTree, 'legend', 'Insert a legend for the selected (or first) map frame.');
  ins('layout.insertScaleBar', 'Scale Bar', Ruler, 'scalebar', 'Insert a scale bar linked to a map frame.');
  ins('layout.insertNorthArrow', 'North Arrow', Compass, 'northarrow', 'Insert a north arrow that follows the map rotation.');
  ins('layout.insertRect', 'Rectangle', Square, 'rect', 'Insert a rectangle or neatline.');
  ins('layout.insertImage', 'Picture', ImagePlus, 'image', 'Insert a picture from a file (logo, photo).');

  // arrange
  const sel = (id: string, title: string, icon: LucideIcon, fn: (lid: Id) => void, extra: { shortcut?: string; description?: string } = {}) =>
    registerCommand({ id, title, icon, run: withLayout(fn), enabled: hasSelection, ...extra });
  sel('layout.bringForward', 'Bring Forward', ChevronsUp, (id) => reorder(id, 'forward'));
  sel('layout.sendBackward', 'Send Backward', ChevronsDown, (id) => reorder(id, 'backward'));
  sel('layout.bringToFront', 'Bring to Front', ArrowUpToLine, (id) => reorder(id, 'front'));
  sel('layout.sendToBack', 'Send to Back', ArrowDownToLine, (id) => reorder(id, 'back'));
  sel('layout.deleteElements', 'Delete Elements', Trash, deleteSelection, { description: 'Delete the selected layout elements.' });
  sel('layout.duplicateElements', 'Duplicate Elements', CopyPlus, duplicateSelection);
  sel('layout.lockElements', 'Lock Elements', Lock, (id) => setLocked(id, getSelectionIds(id), true));
  registerCommand({
    id: 'layout.align', title: 'Align', icon: AlignStartVertical, description: 'Align the selected elements (a single element aligns to the page).',
    run: (mode: AlignMode = 'left') => withLayout((id) => align(id, mode))(), enabled: hasSelection,
  });
  registerCommand({
    id: 'layout.distributeH', title: 'Distribute Horizontally', icon: AlignHorizontalDistributeCenter,
    run: withLayout((id) => distribute(id, 'h')), enabled: () => !!activeLayoutId() && selectedElements(activeLayoutId()!).length > 2,
  });
  registerCommand({
    id: 'layout.distributeV', title: 'Distribute Vertically', icon: AlignVerticalDistributeCenter,
    run: withLayout((id) => distribute(id, 'v')), enabled: () => !!activeLayoutId() && selectedElements(activeLayoutId()!).length > 2,
  });

  // export
  registerCommand({
    id: 'layout.exportPdf', title: 'Export PDF', icon: FileText, description: 'Export the layout page as a PDF document.',
    run: withLayout((id) => openDialog('layout-export', { layoutId: id, format: 'pdf' })), enabled: hasLayout,
  });
  registerCommand({
    id: 'layout.exportPng', title: 'Export PNG', icon: FileImage, description: 'Export the layout page as a PNG image.',
    run: withLayout((id) => openDialog('layout-export', { layoutId: id, format: 'png' })), enabled: hasLayout,
  });
  registerCommand({
    id: 'layout.export', title: 'Export Layout', icon: FileDown, description: 'Export the active layout to PDF or PNG.',
    run: withLayout((id) => openDialog('layout-export', { layoutId: id })), enabled: hasLayout,
  });
  registerCommand({
    id: 'layout.print', title: 'Print', icon: Printer, description: 'Print the active layout with the browser print dialog.',
    run: withLayout((id) => void printLayout(id)), enabled: hasLayout,
  });

  // ---------- ribbon ----------
  registerRibbonGroup({
    tab: 'layout', id: 'page', title: 'Page', order: 10,
    items: [
      { type: 'button', command: 'layout.pageSetup' },
      { type: 'button', command: 'layout.zoomToPage' },
      { type: 'custom', render: () => stack(
        <RbButton key="r" command="layout.toggleRulers" size="small" />,
        <RbButton key="g" command="layout.toggleGuides" size="small" />,
        <RbButton key="s" command="layout.toggleSnap" size="small" />,
      ) },
      { type: 'custom', render: () => stack(
        <RbButton key="grid" command="layout.toggleGrid" size="small" />,
        <RbButton key="z" command="layout.zoom100" size="small" label="100%" />,
      ) },
    ],
  });
  registerRibbonGroup({
    tab: 'layout', id: 'insert', title: 'Insert', order: 20,
    items: [
      {
        type: 'menu', label: 'Map Frame', icon: MapIcon,
        items: () => {
          const maps = getProject().maps;
          return maps.length ? maps.map((m) => ({ command: 'layout.insertMap', label: m.name, arg: m.id })) : [{ command: 'map.new', label: 'New Map' }];
        },
      },
      { type: 'button', command: 'layout.insertText' },
      { type: 'button', command: 'layout.insertLegend' },
      { type: 'button', command: 'layout.insertScaleBar' },
      { type: 'button', command: 'layout.insertNorthArrow' },
      { type: 'stack', items: [
        { type: 'button', command: 'layout.insertRect' },
        { type: 'button', command: 'layout.insertImage' },
      ] },
    ],
  });
  registerRibbonGroup({
    tab: 'layout', id: 'arrange', title: 'Arrange', order: 30,
    items: [
      { type: 'custom', render: () => <RbButton command="layout.bringForward" /> },
      { type: 'custom', render: () => <RbButton command="layout.sendBackward" /> },
      { type: 'custom', render: () => stack(
        <RbMenu key="a" label="Align" icon={AlignStartVertical} size="small" enabled={hasSelection}
          items={() => ALIGN.map((a) => ({ label: a.label, icon: <a.icon size={14} />, onClick: () => runCommand('layout.align', a.mode) }))} />,
        <RbMenu key="d" label="Distribute" icon={AlignHorizontalDistributeCenter} size="small"
          enabled={() => !!activeLayoutId() && selectedElements(activeLayoutId()!).length > 2}
          items={() => [
            { label: 'Distribute Horizontally', icon: <AlignHorizontalDistributeCenter size={14} />, onClick: () => runCommand('layout.distributeH') },
            { label: 'Distribute Vertically', icon: <AlignVerticalDistributeCenter size={14} />, onClick: () => runCommand('layout.distributeV') },
          ]} />,
        <RbButton key="x" command="layout.deleteElements" size="small" label="Delete" />,
      ) },
    ],
  });
  registerRibbonGroup({
    tab: 'layout', id: 'export', title: 'Export', order: 40,
    items: [
      { type: 'button', command: 'layout.exportPdf' },
      { type: 'button', command: 'layout.exportPng' },
      { type: 'button', command: 'layout.print', size: 'small' },
    ],
  });
  registerRibbonGroup({
    tab: 'share', id: 'print', title: 'Print', order: 20,
    items: [
      { type: 'button', command: 'layout.export' },
      { type: 'button', command: 'layout.new' },
      { type: 'button', command: 'layout.print', size: 'small' },
    ],
  });
}
