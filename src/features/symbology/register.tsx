// Registration of the symbology module: pane, commands and ribbon groups.
import { Palette, Tag, Type, ZoomIn, ZoomOut, SlidersHorizontal } from 'lucide-react';
import type { FeatureLayer } from '../../core/types';
import { defaultLabels, fieldRef, findFeatureLayer, findLayer, updateLayer, useLayer } from '../../core/store';
import { activeLayerId, notify, setActiveLayer, useActiveLayerId } from '../../core/ui';
import { registerCommand, registerPane, registerRibbonGroup, openPane, type RibbonMenuEntry } from '../../core/registry';
import { getMapHandle } from '../../map/handle';
import { Slider } from '../../ui/kit';
import { SymbologyPane } from './SymbologyPane';
import './symbology.css';

/** Layer named by a command argument (a layer id), falling back to the active layer. */
function target(arg: unknown) {
  const id = typeof arg === 'string' ? arg : activeLayerId();
  return findFeatureLayer(id);
}

function openFor(arg: unknown, tab: 'symbology' | 'labeling') {
  const hit = target(arg);
  if (!hit) return notify('Select a feature layer in Contents first.', 'info');
  setActiveLayer(hit.layer.id);
  openPane('symbology', { layerId: hit.layer.id, tab });
}

function setZoomLimit(key: 'minZoom' | 'maxZoom', arg: unknown) {
  const layer = findLayer(activeLayerId())?.layer;
  if (!layer) return notify('Select a layer in Contents first.', 'info');
  let value: number | undefined;
  if (arg === 'clear') value = undefined;
  else if (arg === 'current') {
    const handle = getMapHandle();
    if (!handle) return notify('Open a map view to read its current zoom.', 'info');
    value = Math.round(handle.getViewState().zoom * 10) / 10;
  } else if (typeof arg === 'number') value = arg;
  else return;
  updateLayer(layer.id, { [key]: value });
}

const zoomMenu = (key: 'minZoom' | 'maxZoom'): RibbonMenuEntry[] => {
  const cmd = key === 'minZoom' ? 'layer.minZoom' : 'layer.maxZoom';
  const zoom = getMapHandle()?.getViewState().zoom;
  const cur = findLayer(activeLayerId())?.layer[key];
  return [
    { command: cmd, label: zoom !== undefined ? `Set to current zoom (${zoom.toFixed(1)})` : 'Set to current zoom', arg: 'current' },
    { command: cmd, label: cur !== undefined ? `Clear (currently ${cur})` : 'Clear (unlimited)', arg: 'clear' },
    'separator',
    ...[2, 4, 6, 8, 10, 12, 14, 16, 18].map((n) => ({ command: cmd, label: `Zoom ${n}`, arg: n })),
  ];
};

function OpacityControl() {
  const layer = useLayer(useActiveLayerId());
  return (
    <div className="sy-rb-opacity" style={layer ? undefined : { opacity: 0.4, pointerEvents: 'none' }}>
      <span className="lbl">Layer opacity</span>
      <Slider value={layer?.opacity ?? 1} onChange={(v) => layer && updateLayer(layer.id, { opacity: v })} format={(v) => `${Math.round(v * 100)}%`} />
    </div>
  );
}

export function register() {
  registerPane({ id: 'symbology', title: 'Symbology', icon: Palette, dock: 'right', component: SymbologyPane });

  registerCommand({
    id: 'layer.symbology',
    title: 'Symbology',
    icon: Palette,
    description: 'Style a layer: single symbol, unique values, graduated colours or symbols, heat map',
    keywords: 'style renderer colour color classify ramp legend',
    run: (arg) => openFor(arg, 'symbology'),
  });
  registerCommand({
    id: 'layer.labeling',
    title: 'Label properties',
    icon: SlidersHorizontal,
    description: 'Configure labels for a layer',
    keywords: 'label text font halo expression',
    run: (arg) => openFor(arg, 'labeling'),
  });
  registerCommand({
    id: 'layer.toggleLabels',
    title: 'Label',
    icon: Tag,
    description: 'Turn labels on or off for the active layer',
    keywords: 'labels annotation text',
    active: () => !!target(undefined)?.layer.labels.enabled,
    run: (arg) => {
      const hit = target(arg);
      if (!hit) return notify('Select a feature layer in Contents first.', 'info');
      const { layer, dataset } = hit;
      const enabled = !layer.labels.enabled;
      const labels = { ...layer.labels, enabled };
      if (enabled && !labels.expression.trim()) labels.expression = defaultLabels(dataset).expression;
      if (enabled && !labels.expression.trim()) return notify('This layer has no fields to label with.', 'warning');
      updateLayer<FeatureLayer>(layer.id, { labels });
    },
  });
  registerCommand({
    id: 'layer.labelField',
    title: 'Label by field',
    icon: Type,
    description: 'Label the active layer with one field',
    run: (field) => {
      const hit = target(undefined);
      if (!hit || typeof field !== 'string') return notify('Select a feature layer in Contents first.', 'info');
      updateLayer<FeatureLayer>(hit.layer.id, { labels: { ...hit.layer.labels, enabled: true, expression: fieldRef(field) } });
    },
  });
  registerCommand({ id: 'layer.minZoom', title: 'Minimum visible zoom', icon: ZoomOut, run: (arg) => setZoomLimit('minZoom', arg) });
  registerCommand({ id: 'layer.maxZoom', title: 'Maximum visible zoom', icon: ZoomIn, run: (arg) => setZoomLimit('maxZoom', arg) });

  registerRibbonGroup({
    tab: 'layer',
    id: 'drawing',
    title: 'Drawing',
    order: 10,
    items: [
      { type: 'button', command: 'layer.symbology', size: 'large', label: 'Symbology' },
      { type: 'custom', render: () => <OpacityControl /> },
      {
        type: 'stack',
        items: [
          { type: 'menu', label: 'Min zoom', icon: ZoomOut, size: 'small', items: () => zoomMenu('minZoom') },
          { type: 'menu', label: 'Max zoom', icon: ZoomIn, size: 'small', items: () => zoomMenu('maxZoom') },
        ],
      },
    ],
  });

  registerRibbonGroup({
    tab: 'layer',
    id: 'labeling',
    title: 'Labeling',
    order: 20,
    items: [
      { type: 'button', command: 'layer.toggleLabels', size: 'large', label: 'Label' },
      {
        type: 'stack',
        items: [
          {
            type: 'menu',
            label: 'Label field',
            icon: Type,
            size: 'small',
            items: () => (target(undefined)?.dataset.fields ?? []).map((f) => ({ command: 'layer.labelField', label: f.alias ? `${f.alias} (${f.name})` : f.name, arg: f.name })),
          },
          { type: 'button', command: 'layer.labeling', size: 'small', label: 'Label properties' },
        ],
      },
    ],
  });
}
