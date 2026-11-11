// Shared helpers: editable layers, selection resolution with user feedback, templates.
import type { Dataset, Feat, FeatureLayer, Id, MapDoc } from '../../core/types';
import { coerce, featureById, getDataset } from '../../core/data';
import { getMap, isLayerVisible } from '../../core/store';
import { notify, useUi } from '../../core/ui';
import type { Family } from './geom';
import type { Template } from './state';

export interface LayerRef {
  layer: FeatureLayer;
  dataset: Dataset;
}
export interface SelGroup extends LayerRef {
  feats: Feat[];
}

export const activeMap = (): MapDoc | undefined => getMap(useUi.getState().activeMapId);

export function featureLayers(map: MapDoc | undefined): LayerRef[] {
  const out: LayerRef[] = [];
  for (const l of map?.layers ?? []) {
    if (l.kind !== 'feature') continue;
    const dataset = getDataset(l.datasetId);
    if (dataset && dataset.geomType) out.push({ layer: l, dataset });
  }
  return out;
}

export const editableLayers = (map: MapDoc | undefined, visibleOnly = false): LayerRef[] =>
  featureLayers(map).filter((x) => x.layer.editable && (!visibleOnly || (map && isLayerVisible(map, x.layer))));

/** Selected features of the active map split into editable groups and locked (non-editable) layers. */
export function resolveSelection(map = activeMap()): { groups: SelGroup[]; locked: LayerRef[]; total: number } {
  const sel = useUi.getState().selection;
  const groups: SelGroup[] = [];
  const locked: LayerRef[] = [];
  let total = 0;
  for (const ref of featureLayers(map)) {
    const fids = sel[ref.layer.id];
    if (!fids?.length) continue;
    total += fids.length;
    if (!ref.layer.editable) {
      locked.push(ref);
      continue;
    }
    const feats = fids.map((id) => featureById(ref.dataset.id, id)).filter(Boolean) as Feat[];
    if (feats.length) groups.push({ ...ref, feats });
  }
  return { groups, locked, total };
}

const quoteList = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

export function lockedMessage(locked: LayerRef[]): string {
  if (!locked.length) return 'Select one or more features in an editable layer first.';
  const names = quoteList(locked.map((l) => l.layer.name));
  return `${names} ${locked.length === 1 ? 'is' : 'are'} not editable. Turn on editing for the layer in the Create Features pane or its layer properties.`;
}

/**
 * Editable selection for a command, or null after telling the user why not.
 * `verb` completes "Select features to …".
 */
export function requireSelection(verb: string, opts: { families?: Family[]; min?: number } = {}): SelGroup[] | null {
  const map = activeMap();
  if (!map) {
    notify('Open a map first.', 'warning');
    return null;
  }
  const { groups, locked, total } = resolveSelection(map);
  if (!total) {
    notify(`Select one or more features to ${verb}.`, 'info');
    return null;
  }
  if (!groups.length) {
    notify(lockedMessage(locked), 'warning');
    return null;
  }
  if (locked.length) notify(`${lockedMessage(locked)} Their selected features were skipped.`, 'warning');
  let out = groups;
  if (opts.families) {
    const fam = opts.families;
    out = groups.filter((g) => fam.includes(g.dataset.geomType as Family));
    if (!out.length) {
      const what = fam.map((f) => (f === 'LineString' ? 'line' : f.toLowerCase())).join(' or ');
      notify(`Only ${what} features can be used to ${verb}.`, 'warning');
      return null;
    }
  }
  const count = out.reduce((n, g) => n + g.feats.length, 0);
  if (opts.min && count < opts.min) {
    notify(`Select at least ${opts.min} features to ${verb}.`, 'info');
    return null;
  }
  return out;
}

/** Most likely display field of a dataset. */
export function nameField(ds: Dataset): string | null {
  const f =
    ds.fields.find((x) => /^(name|title|label)$/i.test(x.name)) ??
    ds.fields.find((x) => /name/i.test(x.name) && x.type === 'string') ??
    ds.fields.find((x) => x.type === 'string');
  return f?.name ?? null;
}

export function displayName(ds: Dataset, feat: Feat): string {
  const nf = nameField(ds);
  const v = nf ? feat.properties[nf] : null;
  return v === null || v === undefined || v === '' ? `Feature ${feat.id}` : String(v);
}

/** Feature templates for a layer: one per unique-value class (pre-filling the class field), else one. */
export function templatesFor(layer: FeatureLayer, ds: Dataset): Template[] {
  const r = layer.renderer;
  if (r.type === 'unique' && r.classes.length) {
    const field = ds.fields.find((f) => f.name === r.field);
    return r.classes
      .filter((c) => c.visible !== false)
      .map((c) => ({
        key: `${layer.id}|${c.value}`,
        layerId: layer.id,
        label: c.label || c.value || '<empty>',
        presets: field ? { [field.name]: coerce(c.value, field.type) } : {},
      }));
  }
  return [{ key: layer.id, layerId: layer.id, label: layer.name, presets: {} }];
}

/** Copy properties onto a target schema (matching field names, coerced to the target type). */
export function mapProperties(props: Record<string, any>, target: Dataset): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of target.fields) if (f.name in props) out[f.name] = coerce(props[f.name], f.type);
  return out;
}

export const familyLabel = (f: Family | null | undefined) => (f === 'LineString' ? 'line' : f === 'Polygon' ? 'polygon' : f === 'Point' ? 'point' : 'table');

export function layerById(map: MapDoc | undefined, id: Id): LayerRef | undefined {
  return featureLayers(map).find((x) => x.layer.id === id);
}
