import { createRoot } from 'react-dom/client';
import './ui/styles.css';
import { App } from './app/App';
import { registerCore, registerPaneCommands } from './app/commands';
import { registerFeatures } from './features';
import { startup } from './features/io';
import { getPane, openPane } from './core/registry';
import { findLayer, useProject } from './core/store';
import { subscribeData } from './core/data';
import { pruneLayerState, pruneViews, setSelection, useUi } from './core/ui';

registerCore();
registerFeatures();
registerPaneCommands();

// Keep session state consistent with the project (closed maps, removed layers).
useProject.subscribe((s, prev) => {
  if (s.project.maps !== prev.project.maps || s.project.layouts !== prev.project.layouts || s.project.charts !== prev.project.charts) {
    pruneViews();
    pruneLayerState();
  }
});

// Deleted features must not linger in the selection.
subscribeData((e) => {
  if (e.type !== 'edit' || !e.deletes.length) return;
  const gone = new Set(e.deletes);
  for (const [layerId, ids] of Object.entries(useUi.getState().selection)) {
    const layer = findLayer(layerId)?.layer;
    if (layer?.kind === 'feature' && layer.datasetId === e.datasetId && ids.some((i) => gone.has(i))) setSelection(layerId, ids.filter((i) => !gone.has(i)));
  }
});

document.documentElement.dataset.theme = useUi.getState().theme;
createRoot(document.getElementById('root')!).render(<App />);

startup()
  .catch((err) => console.error('startup failed', err))
  .finally(() => {
    for (const id of ['catalog', 'contents']) if (getPane(id)) openPane(id);
  });

// Debug handle for the console / automated tests.
import * as store from './core/store';
import * as data from './core/data';
import * as ui from './core/ui';
import * as registry from './core/registry';
import { getMapHandle } from './map/handle';
(window as any).terrane = { store, data, ui, registry, getMapHandle };
