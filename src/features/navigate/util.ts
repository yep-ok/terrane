// Shared helpers for the navigate module.
import type { Dataset, Feat, FeatureLayer, Id } from '../../core/types';
import { findFeatureLayer } from '../../core/store';
import { notify, useUi } from '../../core/ui';
import { tryCompile } from '../../core/expr';
import { getMapHandle, type MapHandle } from '../../map/handle';

/** Live handle of the active map; notifies when there is none. */
export function needHandle(): MapHandle | undefined {
  const h = getMapHandle();
  if (!h) notify('Open a map first', 'warning');
  return h;
}

/** Resolve a command argument (layerId or {layerId}) to a feature layer, defaulting to the active layer. */
export function resolveFeatureLayer(arg?: unknown): { layer: FeatureLayer; dataset: Dataset } | undefined {
  const id: Id | null | undefined = typeof arg === 'string' ? arg : (arg as any)?.layerId ?? useUi.getState().activeLayerId;
  const hit = findFeatureLayer(id);
  if (!hit) {
    notify('Select a feature layer in Contents first', 'warning');
    return;
  }
  return { layer: hit.layer, dataset: hit.dataset };
}

/** Features of a layer that pass its definition query. */
export function layerFeatures(layer: FeatureLayer, ds: Dataset): Feat[] {
  const q = layer.definitionQuery?.trim();
  if (!q) return ds.features;
  const { fn } = tryCompile(q);
  return fn ? ds.features.filter((f) => !!fn(f)) : ds.features;
}
