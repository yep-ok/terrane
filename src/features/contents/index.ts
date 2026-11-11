// Contents module: the Contents pane, layer management commands and the layer/map properties dialogs.
import { Layers } from 'lucide-react';
import { isPaneOpen } from '../../core/ui';
import { openPane, registerDialog, registerPane, registerRibbonGroup } from '../../core/registry';
import { registerCommands } from './commands';
import { ContentsPane } from './ContentsPane';
import { ConfirmDialog, LayerPropertiesDialog, MapPropertiesDialog } from './dialogs';
import './contents.css';

export function register() {
  registerPane({ id: 'contents', title: 'Contents', icon: Layers, dock: 'left', component: ContentsPane });

  registerDialog({ id: 'layer-properties', title: 'Layer Properties', width: 580, component: LayerPropertiesDialog });
  registerDialog({ id: 'map-properties', title: 'Map Properties', width: 560, component: MapPropertiesDialog });
  registerDialog({ id: 'contents-confirm', title: (p: any) => p?.title ?? 'Confirm', width: 420, component: ConfirmDialog });

  registerCommands();

  registerRibbonGroup({
    tab: 'insert',
    id: 'project',
    title: 'Project',
    order: 10,
    items: [
      { type: 'button', command: 'map.new', size: 'large', label: 'New Map' },
      { type: 'button', command: 'layout.new', size: 'large', label: 'New Layout' },
      { type: 'button', command: 'chart.new', size: 'large', label: 'New Chart' },
      { type: 'button', command: 'layer.addGroup', size: 'large', label: 'Group Layer' },
    ],
  });

  if (!isPaneOpen('contents')) openPane('contents');
}
