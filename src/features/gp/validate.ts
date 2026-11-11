// Parameter validation for the tool form (uses the project store to check layers and fields).
import { compileWhere } from '../../core/expr';
import { findFeatureLayer } from '../../core/store';
import { geomMatches } from './runner';
import type { ToolDef } from './types';

export function validateParams(tool: ToolDef, params: Record<string, any>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const p of tool.params) {
    if (p.showIf && !p.showIf(params)) continue;
    const v = params[p.name];
    const err = (m: string) => (errors[p.name] = m);
    switch (p.kind) {
      case 'layer': {
        const ids: string[] = Array.isArray(v) ? v : v ? [v] : [];
        if (!ids.length) {
          if (!p.optional) err(p.multiple ? 'Choose at least two layers.' : 'Choose a layer.');
          else break;
        }
        if (p.multiple && !p.optional && ids.length < 2) err('Choose at least two layers.');
        for (const id of ids) {
          const hit = findFeatureLayer(id);
          if (!hit) err('The chosen layer no longer exists.');
          else if (!geomMatches(p.geom, hit.dataset.geomType)) err('This layer has the wrong geometry type.');
        }
        break;
      }
      case 'field': {
        if (!v) {
          if (!p.optional && !p.allowNone) err('Choose a field.');
          break;
        }
        const ds = findFeatureLayer(params[p.layer])?.dataset;
        if (ds && !ds.fields.some((f) => f.name === v)) err(`Field "${v}" was not found.`);
        break;
      }
      case 'fields': {
        if (!Array.isArray(v) || !v.length) {
          if (!p.optional) err('Choose at least one field.');
        }
        break;
      }
      case 'stats': {
        const rows = Array.isArray(v) ? v.filter((r: any) => r?.field) : [];
        if (!rows.length && !p.optional) err('Add at least one statistic.');
        break;
      }
      case 'number':
        if (typeof v !== 'number' || !Number.isFinite(v)) err('Enter a number.');
        else if (p.min !== undefined && v < p.min) err(`Must be at least ${p.min}.`);
        else if (p.max !== undefined && v > p.max) err(`Must be at most ${p.max}.`);
        break;
      case 'distance':
        if (!v || typeof v.value !== 'number' || !Number.isFinite(v.value)) err('Enter a distance.');
        else if (p.min !== undefined && v.value < p.min) err(`Must be at least ${p.min}.`);
        break;
      case 'string':
        if (!p.optional && !String(v ?? '').trim()) err('Enter a value.');
        break;
      case 'where':
        if (String(v ?? '').trim()) {
          try {
            compileWhere(String(v));
          } catch (e: any) {
            err(`Invalid expression: ${e?.message ?? e}`);
          }
        }
        break;
      case 'choice':
        if (!p.options.some((o) => o.value === v)) err('Choose an option.');
        break;
      default:
        break;
    }
  }
  return errors;
}
