// Geoprocessing module: toolbox pane, one command per tool, ribbon groups.
import { History, Wrench } from 'lucide-react';
import { registerCommand, registerPane, registerRibbonGroup, openPane, type RibbonItem } from '../../core/registry';
import { GpPane } from './GpPane';
import { toolIcon } from './icons';
import { ALL_TOOLS } from './tools';

const GALLERY = ['buffer', 'clip', 'intersect', 'union', 'dissolve', 'spatial-join', 'summarize-within', 'near'];
const GALLERY_LABELS: Record<string, string> = { 'spatial-join': 'Spatial Join', 'summarize-within': 'Summarize Within' };

let nonce = 0;
const open = (props: Record<string, any>) => openPane('geoprocessing', { ...props, nonce: ++nonce });

export function register() {
  registerPane({ id: 'geoprocessing', title: 'Geoprocessing', icon: Wrench, dock: 'right', component: GpPane });

  registerCommand({
    id: 'gp.open',
    title: 'Geoprocessing Tools',
    icon: Wrench,
    description: 'Open the Geoprocessing pane. Pass a tool id to open that tool directly.',
    keywords: 'toolbox analysis tools geoprocessing',
    run: (arg?: string | { toolId?: string; params?: Record<string, any> }) => {
      const toolId = typeof arg === 'string' ? arg : arg?.toolId;
      const params = typeof arg === 'object' && arg ? arg.params : undefined;
      open({ toolId, params });
    },
  });
  registerCommand({
    id: 'gp.history',
    title: 'Geoprocessing History',
    icon: History,
    description: 'Review past geoprocessing runs and reopen them with their parameters.',
    keywords: 'history recent runs log',
    run: () => open({ history: true }),
  });

  for (const tool of ALL_TOOLS) {
    registerCommand({
      id: `gp.tool.${tool.id}`,
      title: tool.name,
      icon: toolIcon(tool.id),
      description: `${tool.category}: ${tool.description}`,
      keywords: `${tool.keywords.join(' ')} ${tool.category} geoprocessing tool`,
      run: () => open({ toolId: tool.id }),
    });
  }

  registerRibbonGroup({
    tab: 'analysis',
    id: 'gp',
    title: 'Geoprocessing',
    order: 10,
    items: [
      { type: 'button', command: 'gp.open', size: 'large', label: 'Tools' },
      { type: 'button', command: 'gp.history', size: 'large', label: 'History' },
    ],
  });
  registerRibbonGroup({
    tab: 'analysis',
    id: 'gp-gallery',
    title: 'Tools gallery',
    order: 20,
    items: GALLERY.map((id): RibbonItem => ({ type: 'button', command: `gp.tool.${id}`, size: 'large', label: GALLERY_LABELS[id] })),
  });
}
