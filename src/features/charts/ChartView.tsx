// Center-area chart view: toolbar + responsive SVG chart with linked selection.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { Check, ChartColumn, Copy, FileCode, Image as ImageIcon, ListFilter, Pencil, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import { useDataset, useDatasetVersion } from '../../core/data';
import { compileWhere } from '../../core/expr';
import { updateChart, useProject } from '../../core/store';
import { clearSelection, notify, setSelection, useSelection } from '../../core/ui';
import { openPane } from '../../core/registry';
import type { Feat } from '../../core/types';
import { Button, Empty, IconButton, TextInput, downloadBlob, useSize } from '../../ui/kit';
import { readConfig, type ChartConfig } from './config';
import { ChartSvg } from './ChartSvg';
import { buildModel, modelSummary, modelToTable, tableToCsv, type ChartModel } from './model';
import { pngBlob, safeFileName, svgBlob } from './exporters';
import { focusChart, getChartSvg, registerChartSvg } from './state';
import type { ChartActions } from './svgParts';
import { formatValue } from './stats';
import './charts.css';

// ---------- tooltip (isolated so mouse moves do not re-render the chart) ----------

interface TipApi {
  show(e: { clientX: number; clientY: number }, title: string, rows: string[]): void;
  hide(): void;
}
function ChartTip({ apiRef, host }: { apiRef: RefObject<TipApi | null>; host: RefObject<HTMLDivElement | null> }) {
  const [tip, setTip] = useState<{ x: number; y: number; flip: boolean; title: string; rows: string[] } | null>(null);
  useImperativeHandle(
    apiRef,
    () => ({
      show(e, title, rows) {
        const r = host.current?.getBoundingClientRect();
        if (!r) return;
        const x = e.clientX - r.left;
        setTip({ x, y: e.clientY - r.top, flip: x > r.width * 0.6, title, rows });
      },
      hide: () => setTip(null),
    }),
    [host],
  );
  if (!tip) return null;
  return (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y, transform: `translate(${tip.flip ? 'calc(-100% - 14px)' : '14px'}, -50%)` }}>
      <div className="chart-tip-title">{tip.title}</div>
      {tip.rows.map((r, i) => <div key={i} className="chart-tip-row">{r}</div>)}
    </div>
  );
}

// ---------- data hook (also used by commands for CSV) ----------

export function useChartModel(chartId: string) {
  const chart = useProject((s) => s.project.charts.find((c) => c.id === chartId));
  const layer = useProject((s) => {
    for (const m of s.project.maps) {
      const l = m.layers.find((x) => x.id === chart?.layerId);
      if (l) return l;
    }
    return undefined;
  });
  const dsId = layer?.kind === 'feature' ? layer.datasetId : undefined;
  const ds = useDataset(dsId);
  const version = useDatasetVersion(dsId);
  const selection = useSelection(chart?.layerId);
  const selSet = useMemo(() => new Set(selection), [selection]);
  const query = layer?.kind === 'feature' ? layer.definitionQuery ?? '' : '';
  const renderer = layer?.kind === 'feature' ? layer.renderer : undefined;
  const cfg = useMemo(() => (chart ? readConfig(chart) : undefined), [chart?.config]); // eslint-disable-line react-hooks/exhaustive-deps

  // heavy step: apply the definition query once per dataset version
  const rows = useMemo(() => {
    if (!ds) return { feats: [] as Feat[], error: null as string | null };
    try {
      const where = compileWhere(query);
      return { feats: query.trim() ? ds.features.filter((f) => where(f)) : ds.features, error: null };
    } catch (err: any) {
      return { feats: ds.features, error: err?.message ?? String(err) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ds, version, query]);

  const model: ChartModel | null = useMemo(() => {
    if (!ds || !cfg) return null;
    const feats = cfg.selectionOnly ? rows.feats.filter((f) => selSet.has(f.id)) : rows.feats;
    return buildModel(feats, cfg, ds, selSet, renderer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, cfg, ds, selSet, renderer, version]);

  return { chart, layer, ds, cfg, model, selection, queryError: rows.error };
}

// ---------- view ----------

export function ChartView({ refId, active }: { refId: string; active: boolean }) {
  const { chart, layer, ds, cfg, model, selection, queryError } = useChartModel(refId);
  const [areaRef, size] = useSize<HTMLDivElement>();
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<TipApi | null>(null);
  const [renaming, setRenaming] = useState(false);
  const layerId = chart?.layerId ?? '';

  useEffect(() => {
    if (active) focusChart(refId);
  }, [active, refId]);

  const setSvg = useCallback((el: SVGSVGElement | null) => registerChartSvg(refId, el), [refId]);

  const actions: ChartActions = useMemo(
    () => ({
      select: (fids, e) => setSelection(layerId, fids, e.ctrlKey || e.shiftKey || e.metaKey ? 'add' : 'new'),
      clear: () => clearSelection(layerId),
      tip: (e, title, rows) => tipRef.current?.show(e, title, rows),
      hideTip: () => tipRef.current?.hide(),
    }),
    [layerId],
  );

  if (!chart || !cfg) return <Empty icon={ChartColumn} title="Chart not found" />;
  if (!layer || layer.kind !== 'feature' || !ds) {
    return <Empty icon={TriangleAlert} title="This chart's layer is not available">Choose another layer in Chart Properties.<Button onClick={() => openPane('chart-properties')}>Chart Properties</Button></Empty>;
  }

  const patch = (p: Partial<ChartConfig>) => updateChart(refId, (c) => void (c.config = { ...c.config, ...p }));
  const svg = () => getChartSvg(refId);
  const fileBase = safeFileName(chart.name);

  const exportPng = async () => {
    const el = svg();
    if (!el) return notify('Nothing to export: the chart has no data.', 'warning');
    try {
      downloadBlob(await pngBlob(el, 2), `${fileBase}.png`);
    } catch (err: any) {
      notify(`Export failed: ${err?.message ?? err}`, 'error');
    }
  };
  const exportSvg = () => {
    const el = svg();
    if (!el) return notify('Nothing to export: the chart has no data.', 'warning');
    downloadBlob(svgBlob(el), `${fileBase}.svg`);
  };
  const copyCsv = async () => {
    if (!model || model.kind === 'invalid') return notify('Nothing to copy: the chart has no data.', 'warning');
    try {
      await navigator.clipboard.writeText(tableToCsv(modelToTable(model, cfg)));
      notify('Chart data copied to the clipboard as CSV.', 'success');
    } catch {
      notify('Could not access the clipboard.', 'error');
    }
  };

  const valid = model && model.kind !== 'invalid' ? model : null;

  return (
    <div className="chartview" ref={hostRef}>
      <div className="chart-toolbar">
        {renaming ? (
          <div className="chart-rename">
            <TextInput
              autoFocus
              value={chart.name}
              onChange={(v) => updateChart(refId, (c) => void (c.name = v))}
              onCommit={(v) => {
                if (!v.trim()) updateChart(refId, (c) => void (c.name = 'Chart'));
                setRenaming(false);
              }}
            />
            <IconButton icon={Check} title="Done" onClick={() => setRenaming(false)} />
          </div>
        ) : (
          <button type="button" className="chart-name" title="Rename chart" onClick={() => setRenaming(true)}>
            <span>{chart.name}</span>
            <Pencil size={12} />
          </button>
        )}
        <span className="chart-sep" />
        <IconButton icon={SlidersHorizontal} title="Chart properties" onClick={() => openPane('chart-properties')} />
        <IconButton
          icon={ListFilter}
          title={cfg.selectionOnly ? 'Showing selected features only (click to show all)' : 'Show selected features only'}
          active={cfg.selectionOnly}
          onClick={() => patch({ selectionOnly: !cfg.selectionOnly })}
        />
        <span className="chart-sep" />
        <IconButton icon={ImageIcon} title="Export PNG (2x)" onClick={exportPng} disabled={!valid} />
        <IconButton icon={FileCode} title="Export SVG" onClick={exportSvg} disabled={!valid} />
        <IconButton icon={Copy} title="Copy chart data as CSV" onClick={copyCsv} disabled={!valid} />
        <span className="chart-spacer" />
        <span className="chart-status">
          {layer.name}
          {valid && ` · ${modelSummary(valid)}`}
          {selection.length > 0 && <span className="chart-selcount"> · {formatValue(selection.length)} selected</span>}
          {selection.length > 0 && (
            <button type="button" className="chart-clear" title="Clear selection" onClick={() => clearSelection(layerId)}><X size={11} /></button>
          )}
        </span>
      </div>
      {queryError && <div className="chart-banner"><TriangleAlert size={13} /> The layer's definition query is invalid ({queryError}); showing all features.</div>}
      <div className="chart-area" ref={areaRef}>
        {valid && size.width > 0 && size.height > 0 && (
          <ChartSvg model={valid} cfg={cfg} width={Math.floor(size.width)} height={Math.floor(size.height)} actions={actions} hasSelection={selection.length > 0} svgRef={setSvg} />
        )}
        {model?.kind === 'invalid' && (
          <Empty icon={ChartColumn} title={model.message}>
            {model.detail && <div>{model.detail}</div>}
            <Button onClick={() => openPane('chart-properties')} icon={SlidersHorizontal}>Chart Properties</Button>
          </Empty>
        )}
        <ChartTip apiRef={tipRef} host={areaRef} />
      </div>
      {valid && valid.notes.length > 0 && <div className="chart-notes">{valid.notes.join(' ')}</div>}
    </div>
  );
}
