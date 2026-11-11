// Editing module: create / modify / split tools, feature commands, Create Features
// and Attributes panes, snapping, and the Edit ribbon tab.
import { createElement } from 'react';
import {
  ArrowLeftRight, ClipboardList, ClipboardPaste, Combine, Copy, CopyPlus, Expand, Layers, Magnet, Move, PenTool, Plus,
  RotateCw, Scale, Scissors, SquarePlus, Trash2, Ungroup,
} from 'lucide-react';
import { openPane, registerCommand, registerDialog, registerMapTool, registerPane, registerRibbonGroup } from '../../core/registry';
import { notify, openDialog, setTool, totalSelected, useUi } from '../../core/ui';
import { findLayer, updateLayer } from '../../core/store';
import './editing.css';
import { activateCreate } from './create';
import { activateModify } from './modify';
import { activateSplit } from './split';
import { CreatePane } from './CreatePane';
import { AttributesPane } from './AttributesPane';
import { BufferDialog, MergeDialog, NewLayerDialog, PasteSpecialDialog, TransformDialog } from './dialogs';
import { copySelected, deleteSelected, duplicateSelected, explodeSelected, flipSelected, paste } from './ops';
import { useEdit } from './state';
import { requireSelection } from './util';
import { SnapRibbonButton } from './SnapRibbonButton';

const hasMap = () => !!useUi.getState().activeMapId;
const hasSelection = () => hasMap() && totalSelected() > 0;

export function register() {
  // ----- panes & dialogs -----
  registerPane({ id: 'create-features', title: 'Create Features', icon: SquarePlus, dock: 'right', component: CreatePane });
  registerPane({ id: 'attributes', title: 'Attributes', icon: ClipboardList, dock: 'right', component: AttributesPane });
  registerDialog({ id: 'editing.newLayer', title: 'New Empty Layer', width: 440, component: NewLayerDialog });
  registerDialog({ id: 'editing.pasteSpecial', title: 'Paste Special', width: 400, component: PasteSpecialDialog });
  registerDialog({ id: 'editing.merge', title: 'Merge Features', width: 420, component: MergeDialog });
  registerDialog({ id: 'editing.buffer', title: 'Buffer Features', width: 440, component: BufferDialog });
  registerDialog({ id: 'editing.transform', title: (p: any) => (p?.kind === 'scale' ? 'Scale Features' : 'Rotate Features'), width: 420, component: TransformDialog });

  // ----- map tools -----
  registerMapTool(
    { id: 'edit-create', title: 'Create Features', icon: PenTool, cursor: 'crosshair', activate: activateCreate },
    { description: 'Digitise new features from a feature template.', keywords: 'draw digitize sketch add new feature' },
  );
  registerMapTool(
    { id: 'edit-modify', title: 'Modify', icon: PenTool, activate: (h) => activateModify(h, 'modify') },
    { description: 'Edit the vertices of a feature; drag inside it to move it. Alt+click deletes a vertex.', keywords: 'vertex vertices reshape edit geometry' },
  );
  registerMapTool(
    { id: 'edit-move', title: 'Move', icon: Move, cursor: 'move', activate: (h) => activateModify(h, 'move') },
    { description: 'Drag selected features to move them; arrow keys nudge.', keywords: 'translate drag nudge shift' },
  );
  registerMapTool(
    { id: 'edit-split', title: 'Split', icon: Scissors, cursor: 'crosshair', activate: activateSplit },
    { description: 'Draw a line to split the selected lines or polygons.', keywords: 'cut divide' },
  );

  // ----- commands -----
  registerCommand({
    id: 'edit.create', title: 'Create', icon: SquarePlus, enabled: hasMap,
    description: 'Open Create Features and start digitising with the current template.',
    keywords: 'new feature draw digitize template',
    active: () => useUi.getState().activeTool === 'edit-create',
    run: () => {
      openPane('create-features');
      setTool('edit-create');
    },
  });
  registerCommand({
    id: 'edit.newLayer', title: 'New Layer', icon: Plus, enabled: hasMap,
    description: 'Create an empty point, line or polygon layer to digitise into.', keywords: 'empty dataset feature class create',
    run: () => openDialog('editing.newLayer'),
  });
  registerCommand({
    id: 'edit.attributes', title: 'Attributes', icon: ClipboardList, description: 'Show and edit the attributes of the selected features.',
    keywords: 'properties identify fields values', run: () => openPane('attributes'),
  });
  registerCommand({
    id: 'edit.delete', title: 'Delete', icon: Trash2, shortcut: 'Delete', enabled: hasSelection,
    description: 'Delete the selected features.', keywords: 'remove erase', run: deleteSelected,
  });
  registerCommand({
    id: 'edit.copy', title: 'Copy', icon: Copy, shortcut: 'Ctrl+C', enabled: hasSelection,
    description: 'Copy the selected features to the clipboard.', run: copySelected,
  });
  registerCommand({
    id: 'edit.paste', title: 'Paste', icon: ClipboardPaste, shortcut: 'Ctrl+V', enabled: hasMap,
    description: 'Paste copied features into the active layer.',
    run: (layerId?: string) => {
      if (!paste(typeof layerId === 'string' ? layerId : undefined)) openDialog('editing.pasteSpecial');
    },
  });
  registerCommand({
    id: 'edit.pasteSpecial', title: 'Paste Special…', icon: ClipboardPaste, shortcut: 'Ctrl+Shift+V', enabled: hasMap,
    description: 'Paste copied features into a layer you choose.',
    run: () => {
      if (!useEdit.getState().clipboard) return notify('The clipboard is empty. Copy features first.', 'info');
      openDialog('editing.pasteSpecial');
    },
  });
  registerCommand({
    id: 'edit.duplicate', title: 'Duplicate', icon: CopyPlus, shortcut: 'Ctrl+D', enabled: hasSelection,
    description: 'Copy the selected features in place in the same layer.', run: duplicateSelected,
  });
  registerCommand({
    id: 'edit.merge', title: 'Merge', icon: Combine, enabled: hasSelection,
    description: 'Combine the selected features of one layer into one feature.', keywords: 'union dissolve combine join',
    run: () => {
      const groups = requireSelection('merge', { min: 2 });
      if (!groups) return;
      if (groups.length > 1) return notify('Merge works on features of one layer. Select features from a single layer.', 'warning');
      const g = groups[0];
      if (g.feats.length < 2) return notify('Select at least 2 features of the layer to merge.', 'info');
      openDialog('editing.merge', { layerId: g.layer.id, fids: g.feats.map((f) => f.id) });
    },
  });
  registerCommand({
    id: 'edit.explode', title: 'Explode', icon: Ungroup, enabled: hasSelection,
    description: 'Separate multipart features into single-part features.', keywords: 'multipart singlepart separate', run: explodeSelected,
  });
  registerCommand({
    id: 'edit.split', title: 'Split', icon: Scissors, enabled: hasMap,
    description: 'Draw a line to split the selected lines or polygons.', keywords: 'cut divide',
    active: () => useUi.getState().activeTool === 'edit-split',
    run: () => {
      setTool('edit-split');
      if (!totalSelected()) notify('Select the lines or polygons to split, then draw a line across them.', 'info');
    },
  });
  registerCommand({
    id: 'edit.buffer', title: 'Buffer', icon: Expand, enabled: hasSelection,
    description: 'Replace the selected polygons with buffers, or add buffered copies to a polygon layer.', keywords: 'offset grow shrink',
    run: () => {
      if (requireSelection('buffer')) openDialog('editing.buffer');
    },
  });
  registerCommand({
    id: 'edit.rotate', title: 'Rotate', icon: RotateCw, enabled: hasSelection,
    description: 'Rotate the selected features by an angle.', keywords: 'turn angle',
    run: () => {
      if (requireSelection('rotate')) openDialog('editing.transform', { kind: 'rotate' });
    },
  });
  registerCommand({
    id: 'edit.scale', title: 'Scale', icon: Scale, enabled: hasSelection,
    description: 'Resize the selected features by a factor.', keywords: 'resize enlarge shrink',
    run: () => {
      if (requireSelection('scale')) openDialog('editing.transform', { kind: 'scale' });
    },
  });
  registerCommand({
    id: 'edit.flipLine', title: 'Flip', icon: ArrowLeftRight, enabled: hasSelection,
    description: 'Reverse the direction of the selected lines.', keywords: 'reverse direction line', run: flipSelected,
  });
  registerCommand({
    id: 'edit.snapping', title: 'Snapping', icon: Magnet, shortcut: 'F9',
    description: 'Snap sketches and vertex edits to vertices and edges of visible layers.', keywords: 'snap magnet',
    active: () => useEdit.getState().snapping,
    run: () => {
      const on = !useEdit.getState().snapping;
      useEdit.setState({ snapping: on });
      notify(`Snapping ${on ? 'on' : 'off'}.`, 'info', 1500);
    },
  });
  registerCommand({
    id: 'edit.snapTolerance', title: 'Snapping Tolerance', icon: Magnet,
    description: 'Set the snapping distance in screen pixels.',
    run: (px?: number) => {
      if (typeof px === 'number' && px > 0) useEdit.setState({ snapTolerance: px, snapping: true });
    },
  });
  registerCommand({
    id: 'edit.toggleEditable', title: 'Toggle Layer Editing', icon: Layers,
    description: 'Allow or prevent editing of the active layer.', keywords: 'lock unlock editable read only',
    run: (layerId?: string) => {
      const id = typeof layerId === 'string' ? layerId : useUi.getState().activeLayerId;
      const hit = findLayer(id);
      if (!hit || hit.layer.kind !== 'feature') return notify('Select a feature layer in Contents first.', 'info');
      updateLayer(hit.layer.id, { editable: !hit.layer.editable });
      notify(`"${hit.layer.name}" is now ${hit.layer.editable ? 'read-only' : 'editable'}.`, 'info');
    },
    active: () => {
      const hit = findLayer(useUi.getState().activeLayerId);
      return hit?.layer.kind === 'feature' && hit.layer.editable;
    },
  });

  // ----- ribbon -----
  const small = (command: string, label?: string) => ({ type: 'button' as const, command, size: 'small' as const, label });
  registerRibbonGroup({
    tab: 'edit', id: 'clipboard', title: 'Clipboard', order: 10,
    items: [
      { type: 'split', command: 'edit.paste', size: 'large', label: 'Paste', items: ['edit.paste', 'edit.pasteSpecial'] },
      { type: 'stack', items: [small('edit.copy'), small('edit.duplicate')] },
    ],
  });
  registerRibbonGroup({
    tab: 'edit', id: 'manage', title: 'Manage Edits', order: 20,
    items: [
      { type: 'stack', items: [small('app.undo'), small('app.redo'), { type: 'custom', render: () => createElement(SnapRibbonButton) }] },
    ],
  });
  registerRibbonGroup({
    tab: 'edit', id: 'features', title: 'Features', order: 30,
    items: [
      { type: 'button', command: 'edit.create', size: 'large' },
      { type: 'button', command: 'tool.edit-modify', size: 'large', label: 'Modify' },
      { type: 'stack', items: [small('tool.edit-move', 'Move'), small('edit.delete'), small('edit.newLayer')] },
    ],
  });
  registerRibbonGroup({
    tab: 'edit', id: 'selection', title: 'Selection', order: 40,
    items: [
      { type: 'button', command: 'tool.select-rect', size: 'large', label: 'Select' },
      { type: 'stack', items: [small('edit.attributes'), small('select.clear', 'Clear')] },
    ],
  });
  registerRibbonGroup({
    tab: 'edit', id: 'tools', title: 'Tools', order: 50,
    items: [
      { type: 'stack', items: [small('edit.split'), small('edit.merge'), small('edit.explode')] },
      { type: 'stack', items: [small('edit.buffer'), small('edit.rotate'), small('edit.scale')] },
      { type: 'stack', items: [small('edit.flipLine')] },
    ],
  });
}
