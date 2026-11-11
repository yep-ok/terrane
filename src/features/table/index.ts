// Attribute table module: bottom-dock table pane, Calculate Field, Select By
// Attributes, Fields and Statistics dialogs, and their commands / ribbon group.
import { Calculator, ListFilter, ListTree, Sigma, Table2 } from 'lucide-react';
import type { Id } from '../../core/types';
import { findFeatureLayer } from '../../core/store';
import { activeLayerId, notify, openDialog, openTable } from '../../core/ui';
import { registerCommand, registerDialog, registerPane, registerRibbonGroup } from '../../core/registry';
import { NUMERIC } from '../../ui/kit';
import { TablePane } from './TablePane';
import { CalculateDialog } from './CalculateDialog';
import { SelectDialog } from './SelectDialog';
import { FieldsDialog } from './FieldsDialog';
import { StatsDialog } from './StatsDialog';

/** Resolve a command argument (layer id, or { layerId, field }) to a feature layer, notifying when there is none. */
function target(arg: unknown): { layerId: Id; field?: string } | null {
  const obj = arg && typeof arg === 'object' && !('nativeEvent' in (arg as object)) ? (arg as { layerId?: Id; field?: string }) : undefined;
  const layerId = typeof arg === 'string' ? arg : obj?.layerId ?? activeLayerId();
  if (!layerId || !findFeatureLayer(layerId)) {
    notify('Select a feature layer in Contents first.', 'warning');
    return null;
  }
  return { layerId, field: obj?.field };
}

export function register() {
  registerPane({ id: 'table', title: 'Attribute Table', icon: Table2, dock: 'bottom', component: TablePane });

  registerDialog({ id: 'table.calculate', title: 'Calculate Field', width: 660, component: CalculateDialog });
  registerDialog({ id: 'table.select', title: 'Select By Attributes', width: 700, component: SelectDialog });
  registerDialog({ id: 'table.fields', title: 'Fields', width: 600, component: FieldsDialog });
  registerDialog({ id: 'table.statistics', title: 'Field Statistics', width: 580, component: StatsDialog });

  registerCommand({
    id: 'layer.table',
    title: 'Attribute Table',
    icon: Table2,
    description: 'Open the attribute table of the layer',
    keywords: 'table records rows attributes data grid',
    run(arg) {
      const t = target(arg);
      if (t) openTable(t.layerId);
    },
  });
  registerCommand({
    id: 'layer.fields',
    title: 'Fields',
    icon: ListTree,
    description: 'View and edit the fields (schema) of the layer',
    keywords: 'schema columns add field rename alias type delete',
    run(arg) {
      const t = target(arg);
      if (t) openDialog('table.fields', { layerId: t.layerId });
    },
  });
  registerCommand({
    id: 'select.byAttributes',
    title: 'Select By Attributes',
    icon: ListFilter,
    description: 'Select features with a query on their attributes',
    keywords: 'query where filter expression select sql',
    run(arg) {
      const t = target(arg);
      if (t) openDialog('table.select', { layerId: t.layerId });
    },
  });
  registerCommand({
    id: 'table.calculateField',
    title: 'Calculate Field',
    icon: Calculator,
    description: 'Fill a field from an expression',
    keywords: 'field calculator expression formula update values',
    run(arg) {
      const t = target(arg);
      if (t) openDialog('table.calculate', { layerId: t.layerId, field: t.field });
    },
  });
  registerCommand({
    id: 'table.statistics',
    title: 'Field Statistics',
    icon: Sigma,
    description: 'Summary statistics and histogram of a numeric field',
    keywords: 'statistics summary mean median histogram sum min max',
    run(arg) {
      const t = target(arg);
      if (!t) return;
      const ds = findFeatureLayer(t.layerId)!.dataset;
      if (!ds.fields.some((f) => NUMERIC.includes(f.type))) return notify('This layer has no numeric fields.', 'warning');
      openDialog('table.statistics', { layerId: t.layerId, field: t.field });
    },
  });

  registerRibbonGroup({
    tab: 'layer',
    id: 'data',
    title: 'Data',
    order: 30,
    items: [
      { type: 'button', command: 'layer.table', size: 'large' },
      { type: 'button', command: 'select.byAttributes', size: 'large' },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'layer.fields', size: 'small' },
          { type: 'button', command: 'table.calculateField', size: 'small' },
          { type: 'button', command: 'table.statistics', size: 'small' },
        ],
      },
    ],
  });
}
