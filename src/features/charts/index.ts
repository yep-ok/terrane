// Charts module: chart view, properties pane, commands and ribbon groups.
import { ChartColumn, FileCode, Image as ImageIcon, Copy, SlidersHorizontal, Trash2 } from 'lucide-react';
import { addChart, findFeatureLayer, getMap, getProject, removeChart } from '../../core/store';
import { activeLayerId, activeMapId, notify, openView, pruneViews } from '../../core/ui';
import {
  openPane, registerCommand, registerPane, registerRibbonGroup, registerView, type RibbonMenuEntry,
} from '../../core/registry';
import { CHART_TYPES, makeConfig, readConfig, type ChartType } from './config';
import { ChartView } from './ChartView';
import { ChartPropertiesPane } from './ChartProperties';
import { pngBlob, safeFileName, svgBlob } from './exporters';
import { TYPE_ICONS } from './icons';
import { focusChart, getActiveChartId, getChart, getChartSvg } from './state';
import { downloadBlob } from '../../ui/kit';

/** Resolve the layer a new chart should use: explicit arg, else the active layer, else the active map's first feature layer. */
function resolveLayer(layerId?: string) {
  const direct = findFeatureLayer(layerId ?? activeLayerId());
  if (direct) return direct;
  const map = getMap(activeMapId()) ?? getProject().maps[0];
  for (const l of map?.layers ?? []) {
    if (l.kind !== 'feature') continue;
    const hit = findFeatureLayer(l.id);
    if (hit) return hit;
  }
  return undefined;
}

function uniqueChartName(base: string) {
  const taken = getProject().charts.map((c) => c.name);
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base} ${i}`)) return `${base} ${i}`;
}

function createChart(type: ChartType, arg?: unknown) {
  const layerId = typeof arg === 'string' ? arg : typeof (arg as any)?.layerId === 'string' ? (arg as any).layerId : undefined;
  const hit = resolveLayer(layerId);
  if (!hit) return notify('Add a feature layer to the map and select it to create a chart.', 'warning');
  const noun = CHART_TYPES.find((c) => c.type === type)!.noun;
  const chart = addChart({
    name: uniqueChartName(`${hit.layer.name} – ${noun}`),
    layerId: hit.layer.id,
    mapId: hit.map.id,
    config: makeConfig(type, hit.dataset),
  });
  openView('chart', chart.id);
  focusChart(chart.id);
  openPane('chart-properties');
}

function activeSvgOrNotify() {
  const id = getActiveChartId();
  const chart = getChart(id);
  const svg = id ? getChartSvg(id) : undefined;
  if (!chart) {
    notify('Open a chart view first.', 'warning');
    return null;
  }
  if (!svg) {
    notify('Nothing to export: the chart has no data.', 'warning');
    return null;
  }
  return { chart, svg };
}

export function register() {
  registerView({
    type: 'chart',
    component: ChartView,
    icon: ChartColumn,
    title: (refId) => getChart(refId)?.name ?? 'Chart',
  });

  registerPane({ id: 'chart-properties', title: 'Chart Properties', icon: SlidersHorizontal, dock: 'right', component: ChartPropertiesPane });

  const hasChart = () => !!getActiveChartId();

  registerCommand({
    id: 'chart.new',
    title: 'New Chart',
    icon: ChartColumn,
    description: 'Create a chart from a feature layer (defaults to the active layer).',
    keywords: 'chart graph plot bar histogram scatter',
    run: (arg) => createChart(typeof (arg as any)?.type === 'string' ? (arg as any).type : 'bar', arg),
  });
  for (const { type, label } of CHART_TYPES) {
    registerCommand({
      id: `chart.new.${type}`,
      title: label,
      icon: TYPE_ICONS[type],
      description: `Create a ${label.toLowerCase()} from the active layer.`,
      keywords: `chart graph create ${type}`,
      run: (arg) => createChart(type, arg),
    });
  }

  registerCommand({
    id: 'chart.properties',
    title: 'Chart Properties',
    icon: SlidersHorizontal,
    description: 'Open the properties of the active chart.',
    enabled: hasChart,
    run: () => openPane('chart-properties'),
  });
  registerCommand({
    id: 'chart.exportPng',
    title: 'Export Chart as PNG',
    icon: ImageIcon,
    description: 'Save the active chart as a 2x PNG image.',
    enabled: hasChart,
    run: async () => {
      const hit = activeSvgOrNotify();
      if (hit) downloadBlob(await pngBlob(hit.svg, 2), `${safeFileName(hit.chart.name)}.png`);
    },
  });
  registerCommand({
    id: 'chart.exportSvg',
    title: 'Export Chart as SVG',
    icon: FileCode,
    description: 'Save the active chart as a standalone SVG file.',
    enabled: hasChart,
    run: () => {
      const hit = activeSvgOrNotify();
      if (hit) downloadBlob(svgBlob(hit.svg), `${safeFileName(hit.chart.name)}.svg`);
    },
  });
  registerCommand({
    id: 'chart.remove',
    title: 'Remove Chart',
    icon: Trash2,
    description: 'Delete the active chart (or the chart id given).',
    enabled: hasChart,
    run: (arg) => {
      const id = typeof arg === 'string' ? arg : getActiveChartId();
      if (!id || !getChart(id)) return;
      removeChart(id);
      pruneViews();
    },
  });
  registerCommand({
    id: 'chart.duplicate',
    title: 'Duplicate Chart',
    icon: Copy,
    description: 'Make a copy of the active chart (or the chart id given).',
    enabled: hasChart,
    run: (arg) => {
      const src = getChart(typeof arg === 'string' ? arg : getActiveChartId());
      if (!src) return;
      const copy = addChart({
        name: uniqueChartName(`${src.name} copy`),
        layerId: src.layerId,
        mapId: src.mapId,
        config: JSON.parse(JSON.stringify(readConfig(src))),
      });
      openView('chart', copy.id);
      focusChart(copy.id);
    },
  });

  const menu = (): RibbonMenuEntry[] => CHART_TYPES.map(({ type, label }) => ({ command: `chart.new.${type}`, label }));
  registerRibbonGroup({
    tab: 'analysis',
    id: 'charts',
    title: 'Charts',
    order: 30,
    items: [
      { type: 'menu', label: 'Create Chart', icon: ChartColumn, size: 'large', items: menu },
      {
        type: 'stack',
        items: [
          { type: 'button', command: 'chart.properties', size: 'small' },
          { type: 'button', command: 'chart.exportPng', size: 'small', label: 'Export PNG' },
          { type: 'button', command: 'chart.exportSvg', size: 'small', label: 'Export SVG' },
        ],
      },
    ],
  });
  registerRibbonGroup({
    tab: 'layer',
    id: 'charts',
    title: 'Charts',
    order: 60,
    items: [{ type: 'menu', label: 'Create Chart', icon: ChartColumn, size: 'large', items: menu }],
  });
}
