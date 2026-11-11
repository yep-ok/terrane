// Main-thread side of geoprocessing: resolve inputs from the project, run the tool in a
// Web Worker (with a main-thread fallback), then add the output to the map.
import { create } from 'zustand';
import { compileWhere } from '../../core/expr';
import { createDataset, uid } from '../../core/data';
import { addDatasetLayer, addLayer, findFeatureLayer, getMap, getProject, removeLayer } from '../../core/store';
import { pushUndo } from '../../core/history';
import { activeMapId, getSelection, notify, setActiveLayer } from '../../core/ui';
import { applyDefaults, runTool } from './exec';
import { addHistory, type LogLine } from './history';
import { ToolError, type LayerData, type ToolDef, type ToolResult } from './types';

export interface RunSummary {
  toolId: string;
  startedAt: number;
  elapsedMs: number | null;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  lines: LogLine[];
  output?: { name: string; count: number; layerId: string };
}
interface RunState {
  active: { toolId: string; fraction: number; message: string } | null;
  /** Last run of each tool, shown in the Messages area. */
  runs: Record<string, RunSummary>;
}
export const useRunState = create<RunState>()(() => ({ active: null, runs: {} }));

class CancelError extends Error {}

let cancelCurrent: (() => void) | null = null;
export const isRunning = () => !!useRunState.getState().active;
export function cancelRun() {
  cancelCurrent?.();
}

export const geomMatches = (allowed: string[] | undefined, geomType: string | null) => !allowed || allowed.includes(geomType ?? 'Table');

/** Id of the layer bound to the first layer parameter (used for naming and the target map). */
export function firstLayerId(tool: ToolDef, params: Record<string, any>): string | null {
  for (const p of tool.params) {
    if (p.kind !== 'layer') continue;
    const v = params[p.name];
    const id = Array.isArray(v) ? v[0] : v;
    if (id) return id;
  }
  return null;
}

export function autoOutputName(tool: ToolDef, params: Record<string, any>): string {
  const first = findFeatureLayer(firstLayerId(tool, params))?.layer.name;
  const prefix = tool.outputPrefix ?? tool.name.replace(/[^A-Za-z0-9]+/g, '');
  return first ? `${prefix}_${first}` : prefix;
}

function uniqueLayerName(base: string, mapId: string): string {
  const taken = new Set((getMap(mapId)?.layers ?? []).map((l) => l.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`)) return `${base} (${i})`;
}

// ---------- input resolution ----------

type Log = (level: LogLine['level'], text: string) => void;

export function resolveInputs(tool: ToolDef, params: Record<string, any>, log: Log): Record<string, LayerData[]> {
  const inputs: Record<string, LayerData[]> = {};
  for (const p of tool.params) {
    if (p.kind !== 'layer') continue;
    if (p.showIf && !p.showIf(params)) continue;
    const raw = params[p.name];
    const ids: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!ids.length) {
      if (!p.optional) throw new ToolError(`${p.label} is required.`);
      continue;
    }
    inputs[p.name] = ids.map((id) => {
      const hit = findFeatureLayer(id);
      if (!hit) throw new ToolError(`The layer chosen for "${p.label}" no longer exists.`);
      const { layer, dataset } = hit;
      if (!geomMatches(p.geom, dataset.geomType)) throw new ToolError(`"${layer.name}" has the wrong geometry type for ${p.label}.`);
      let features = dataset.features;
      const total = features.length;
      const sel = getSelection(id);
      if (sel.length) {
        const set = new Set(sel);
        features = features.filter((f) => set.has(f.id));
        log('info', `${layer.name}: processing ${features.length.toLocaleString()} selected feature${features.length === 1 ? '' : 's'} of ${total.toLocaleString()}.`);
      }
      if (layer.definitionQuery?.trim()) {
        try {
          const keep = compileWhere(layer.definitionQuery);
          const before = features.length;
          features = features.filter((f) => keep(f));
          log('info', `${layer.name}: definition query keeps ${features.length.toLocaleString()} of ${before.toLocaleString()} features.`);
        } catch (e: any) {
          log('warning', `${layer.name}: the definition query could not be applied (${e?.message ?? e}); using all features.`);
        }
      }
      return {
        name: layer.name,
        geomType: dataset.geomType,
        fields: dataset.fields,
        features: features.map((f) => ({ type: 'Feature' as const, id: f.id, geometry: f.geometry, properties: f.properties })),
      };
    });
  }
  return inputs;
}

// ---------- execution ----------

interface Hooks {
  progress(fraction: number, message?: string): void;
  message(text: string, level: 'info' | 'warning'): void;
}

function execute(tool: ToolDef, inputs: Record<string, LayerData[]>, params: Record<string, any>, hooks: Hooks): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let gotMessage = false;
    let worker: Worker | null = null;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      worker?.terminate();
      cancelCurrent = null;
      fn();
    };
    const cancel = () => settle(() => reject(new CancelError()));
    cancelCurrent = cancel;

    const runOnMain = () => {
      worker = null;
      setTimeout(() => {
        if (settled) return;
        try {
          const r = runTool(tool, inputs, params, { progress: hooks.progress, message: hooks.message });
          settle(() => resolve(r));
        } catch (e) {
          settle(() => reject(e));
        }
      }, 30);
    };

    try {
      worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch {
      hooks.message('Web Workers are unavailable, so the tool runs on the main thread.', 'warning');
      return runOnMain();
    }
    worker.onmessage = (e: MessageEvent) => {
      gotMessage = true;
      const m = e.data;
      if (m.type === 'progress') hooks.progress(m.fraction, m.message);
      else if (m.type === 'message') hooks.message(m.text, m.level);
      else if (m.type === 'done') settle(() => resolve(m.result));
      else if (m.type === 'error') settle(() => reject(m.user ? new ToolError(m.message) : new Error(m.message)));
    };
    worker.onerror = (ev) => {
      if (settled) return;
      if (!gotMessage) {
        worker?.terminate();
        hooks.message('The geoprocessing worker could not start, so the tool runs on the main thread.', 'warning');
        runOnMain();
      } else settle(() => reject(new Error(ev.message || 'The geoprocessing worker crashed.')));
    };
    try {
      worker.postMessage({ toolId: tool.id, inputs, params });
    } catch {
      worker.terminate();
      hooks.message('The data could not be sent to the worker, so the tool runs on the main thread.', 'warning');
      runOnMain();
    }
  });
}

function commit(tool: ToolDef, params: Record<string, any>, result: ToolResult, log: Log) {
  const ref = findFeatureLayer(firstLayerId(tool, params));
  const mapId = ref?.map.id ?? activeMapId() ?? getProject().maps[0]?.id;
  if (!mapId) throw new ToolError('Open a map first so the result can be added to it.');
  const base = String(params.output ?? '').trim() || result.name || autoOutputName(tool, params);
  const name = uniqueLayerName(base, mapId);
  const ds = createDataset({ name, features: result.features, fields: result.fields, geomType: result.geomType, source: `${tool.name} tool` });
  const layer = addDatasetLayer(mapId, ds);
  const index = getMap(mapId)?.layers.findIndex((l) => l.id === layer.id) ?? 0;
  pushUndo({
    label: `${tool.name}`,
    undo: () => removeLayer(layer.id),
    redo: () => void addLayer(mapId, layer, index),
  });
  setActiveLayer(layer.id);
  log('success', `Added "${name}" to the map (${ds.features.length.toLocaleString()} ${result.geomType ? 'features' : 'rows'}).`);
  return { name, count: ds.features.length, layerId: layer.id };
}

const fmtElapsed = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} min ${Math.round((ms % 60000) / 1000)} s`);
export { fmtElapsed };

export async function executeRun(tool: ToolDef, rawParams: Record<string, any>): Promise<void> {
  if (isRunning()) return;
  const params = applyDefaults(tool, rawParams);
  const startedAt = Date.now();
  const t0 = performance.now();
  const lines: LogLine[] = [];
  let summary: RunSummary = { toolId: tool.id, startedAt, elapsedMs: null, status: 'running', lines };
  const publish = (patch: Partial<RunSummary> = {}) => {
    summary = { ...summary, ...patch, lines: [...lines] };
    useRunState.setState((s) => ({ runs: { ...s.runs, [tool.id]: summary } }));
  };
  const log: Log = (level, text) => {
    lines.push({ at: performance.now() - t0, level, text });
    publish();
  };
  useRunState.setState({ active: { toolId: tool.id, fraction: 0, message: 'Preparing inputs' } });
  publish();
  log('info', `Started ${tool.name} at ${new Date(startedAt).toLocaleTimeString()}.`);

  let status: HistoryStatus = 'failed';
  let out: { name: string; count: number; layerId: string } | undefined;
  try {
    const inputs = resolveInputs(tool, params, log);
    const n = Object.values(inputs).reduce((s, l) => s + l.reduce((t, x) => t + x.features.length, 0), 0);
    log('info', `Read ${n.toLocaleString()} input feature${n === 1 ? '' : 's'}.`);
    await new Promise((r) => setTimeout(r, 0)); // let the UI paint the running state
    const result = await execute(tool, inputs, params, {
      progress: (fraction, message) =>
        useRunState.setState((s) => (s.active ? { active: { ...s.active, fraction, message: message ?? s.active.message } } : s)),
      message: (text, level) => log(level, text),
    });
    if (!result.features.length) {
      log('warning', 'The tool produced no features, so no layer was added.');
      notify(`${tool.name}: no features were produced.`, 'warning');
      status = 'success';
    } else {
      out = commit(tool, params, result, log);
      status = 'success';
    }
  } catch (e: any) {
    if (e instanceof CancelError) {
      status = 'cancelled';
      log('warning', 'The run was cancelled.');
    } else {
      status = 'failed';
      const text = e instanceof ToolError ? e.message : `Unexpected error: ${e?.message ?? e}`;
      log('error', text);
      if (!(e instanceof ToolError)) console.error(e);
      notify(`${tool.name} failed: ${text}`, 'error');
    }
  }
  const elapsedMs = performance.now() - t0;
  log(status === 'success' ? 'success' : status === 'cancelled' ? 'warning' : 'error', `${status === 'success' ? 'Completed' : status === 'cancelled' ? 'Cancelled' : 'Failed'} after ${fmtElapsed(elapsedMs)}.`);
  publish({ elapsedMs, status, output: out });
  useRunState.setState({ active: null });
  cancelCurrent = null;
  if (status === 'success' && out) notify(`${tool.name}: added "${out.name}" with ${out.count.toLocaleString()} ${out.count === 1 ? 'feature' : 'features'}.`, 'success');
  addHistory({
    id: uid('gph'),
    toolId: tool.id,
    toolName: tool.name,
    params,
    status,
    startedAt,
    elapsedMs,
    output: out?.name,
    count: out?.count,
    lines: lines.slice(0, 80),
  });
}
type HistoryStatus = 'success' | 'failed' | 'cancelled';
