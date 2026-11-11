// Pure tool execution (shared by the worker, the main-thread fallback and the tests).
import { getTool } from './tools';
import { ToolError, type LayerData, type ParamDef, type ToolContext, type ToolDef, type ToolResult } from './types';

export interface RunHooks {
  progress?(fraction: number, message?: string): void;
  message?(text: string, level: 'info' | 'warning'): void;
}

export function defaultValue(p: ParamDef): any {
  switch (p.kind) {
    case 'number':
    case 'distance':
    case 'string':
    case 'choice':
    case 'multichoice':
    case 'boolean':
      return structuredCloneSafe(p.default);
    case 'fields':
    case 'stats':
      return [];
    case 'where':
    case 'output':
    case 'field':
      return '';
    default:
      return undefined;
  }
}
const structuredCloneSafe = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function applyDefaults(tool: ToolDef, params: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...params };
  for (const p of tool.params) if (out[p.name] === undefined || out[p.name] === null) out[p.name] = defaultValue(p);
  return out;
}

export function makeContext(inputs: Record<string, LayerData[]>, params: Record<string, any>, hooks: RunHooks = {}): ToolContext {
  return {
    inputs,
    params,
    progress: (f, m) => hooks.progress?.(Math.max(0, Math.min(1, f)), m),
    message: (t, l = 'info') => hooks.message?.(t, l),
    layerOpt: (name) => inputs[name]?.[0],
    layer(name) {
      const l = inputs[name]?.[0];
      if (!l) throw new ToolError(`Parameter "${name}" needs a layer.`);
      return l;
    },
  };
}

/** Run a tool on resolved inputs. Throws ToolError for user-facing problems. */
export function runTool(tool: ToolDef, inputs: Record<string, LayerData[]>, params: Record<string, any>, hooks: RunHooks = {}): ToolResult {
  const p = applyDefaults(tool, params);
  for (const def of tool.params) {
    if (def.showIf && !def.showIf(p)) continue;
    if (def.kind === 'layer' && !def.optional && !inputs[def.name]?.length) throw new ToolError(`${def.label} is required.`);
    if ((def.kind === 'field') && !def.optional && !def.allowNone && !p[def.name]) throw new ToolError(`${def.label} is required.`);
  }
  return tool.run(makeContext(inputs, p, hooks));
}

export function runToolById(id: string, inputs: Record<string, LayerData[]>, params: Record<string, any> = {}, hooks?: RunHooks): ToolResult {
  const tool = getTool(id);
  if (!tool) throw new ToolError(`Unknown tool: ${id}`);
  return runTool(tool, inputs, params, hooks);
}
