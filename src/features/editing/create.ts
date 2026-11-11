// Map tool 'edit-create': digitise new features from the current template.
import Draw, { createBox, createRegularPolygon, type Options as DrawOptions } from 'ol/interaction/Draw';
import { primaryAction } from 'ol/events/condition';
import type OlGeometry from 'ol/geom/Geometry';
import { CheckCheck, Eraser, LayoutTemplate, Magnet, Undo2, X } from 'lucide-react';
import { createElement } from 'react';
import type { MapHandle } from '../../map/handle';
import { applyEdits } from '../../core/data';
import { getMap, useProject } from '../../core/store';
import { clearSelection, notify, setSelection, showContextMenu, useUi } from '../../core/ui';
import { openPane } from '../../core/registry';
import { cleanGeometry, isValidSketch, type Family } from './geom';
import { CONSTRUCTIONS, setTemplate, useEdit, type Construction } from './state';
import { attachSnapping } from './snapping';
import { editableLayers, layerById, templatesFor } from './util';
import { isTyping, mapHint } from './hint';

const icon = (c: any) => createElement(c, { size: 14 });

function drawOptions(c: Construction, sides: number): DrawOptions {
  switch (c) {
    case 'point':
      return { type: 'Point' };
    case 'line':
      return { type: 'LineString' };
    case 'freehand-line':
      return { type: 'LineString', freehand: true };
    case 'polygon':
      return { type: 'Polygon' };
    case 'freehand-polygon':
      return { type: 'Polygon', freehand: true };
    case 'rectangle':
      return { type: 'Circle', geometryFunction: createBox() };
    case 'circle':
      return { type: 'Circle', geometryFunction: createRegularPolygon(72) };
    case 'ngon':
      return { type: 'Circle', geometryFunction: createRegularPolygon(Math.max(3, Math.round(sides))) };
  }
}

function hintFor(c: Construction, layer: string): string {
  const target = `Creating in ${layer} · `;
  switch (c) {
    case 'point':
      return target + 'Click to place a point';
    case 'line':
    case 'polygon':
      return target + 'Click to add vertices · Double-click or F2 to finish · Backspace removes the last vertex · Esc cancels';
    case 'freehand-line':
    case 'freehand-polygon':
      return target + 'Drag to draw · Release to finish · Esc cancels';
    case 'rectangle':
      return target + 'Click one corner, then the opposite corner · Esc cancels';
    default:
      return target + 'Click the centre, then click to set the radius · Esc cancels';
  }
}

/** Make sure a template is chosen: prefer the active layer, else the first editable layer of the map. */
function ensureTemplate(handle: MapHandle) {
  const map = getMap(handle.mapId);
  const cur = useEdit.getState().template;
  if (cur && layerById(map, cur.layerId)?.layer.editable) return;
  const layers = editableLayers(map);
  const active = useUi.getState().activeLayerId;
  const pick = layers.find((l) => l.layer.id === active) ?? layers[0];
  if (pick) setTemplate(templatesFor(pick.layer, pick.dataset)[0], pick.dataset.geomType);
  else setTemplate(null);
}

export function activateCreate(handle: MapHandle): () => void {
  const hint = mapHint(handle);
  let draw: Draw | null = null;
  let sketching = false;
  let structKey = '';

  ensureTemplate(handle);
  if (!useUi.getState().docks.right.panes.includes('create-features')) openPane('create-features');

  const commit = (olGeom: OlGeometry | undefined) => {
    const t = useEdit.getState().template;
    const ref = t && layerById(getMap(handle.mapId), t.layerId);
    if (!t || !ref || !olGeom) return;
    if (!ref.layer.editable) return notify(`"${ref.layer.name}" is not editable.`, 'warning');
    const geometry = cleanGeometry(handle.toGeoJSON(olGeom));
    if (!isValidSketch(geometry)) return notify('The sketch has too few distinct vertices to make a feature.', 'warning');
    const ids = applyEdits(ref.dataset.id, { adds: [{ geometry, properties: { ...t.presets } }] }, { label: `Create feature in ${ref.layer.name}` });
    clearSelection();
    setSelection(ref.layer.id, ids);
  };

  const build = () => {
    if (draw) handle.map.removeInteraction(draw);
    draw = null;
    sketching = false;
    handle.setDragPan(true);
    const { template, construction, ngonSides } = useEdit.getState();
    const map = getMap(handle.mapId);
    const ref = template ? layerById(map, template.layerId) : undefined;
    structKey = ref ? `${ref.layer.id}|${ref.layer.editable}|${ref.dataset.geomType}` : '';
    if (!template || !ref) {
      hint.set(editableLayers(map).length ? 'Choose a feature template in the Create Features pane' : 'This map has no editable feature layers · Add data or create a new empty layer');
      return;
    }
    if (!ref.layer.editable) {
      hint.set(`"${ref.layer.name}" is not editable`);
      return;
    }
    const fam = ref.dataset.geomType as Family;
    const valid = CONSTRUCTIONS[fam];
    const c = valid.includes(construction) ? construction : valid[0];
    const opts = drawOptions(c, ngonSides);
    draw = new Draw({ ...opts, condition: (e) => primaryAction(e), stopClick: true });
    if (opts.freehand) handle.setDragPan(false);
    draw.on('drawstart', () => (sketching = true));
    draw.on('drawabort', () => (sketching = false));
    draw.on('drawend', (e) => {
      sketching = false;
      try {
        commit(e.feature.getGeometry() ?? undefined);
      } catch (err: any) {
        notify(`Create feature: ${err?.message ?? err}`, 'error');
      }
    });
    handle.map.addInteraction(draw);
    snapper.refresh();
    hint.set(hintFor(c, template.label === ref.layer.name ? ref.layer.name : `${ref.layer.name} (${template.label})`));
  };

  const snapper = attachSnapping(handle);
  build();

  const unsubEdit = useEdit.subscribe((s, p) => {
    if (s.template !== p.template || s.construction !== p.construction || s.ngonSides !== p.ngonSides) build();
  });
  const unsubProject = useProject.subscribe(() => {
    const t = useEdit.getState().template;
    const ref = t ? layerById(getMap(handle.mapId), t.layerId) : undefined;
    const key = ref ? `${ref.layer.id}|${ref.layer.editable}|${ref.dataset.geomType}` : '';
    if (key !== structKey) {
      if (t && !ref) ensureTemplate(handle);
      build();
    }
  });

  const finish = () => draw && sketching && draw.finishDrawing();
  const undoVertex = () => draw && sketching && draw.removeLastPoint();
  const cancel = () => draw && sketching && draw.abortDrawing();

  const onKey = (e: KeyboardEvent) => {
    if (!draw || isTyping(e.target) || useUi.getState().dialogs.length) return;
    const k = e.key;
    const consume = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (k === 'F2') {
      finish();
      consume();
    } else if (k === 'Escape' && sketching && !useUi.getState().contextMenu) {
      cancel();
      consume();
    } else if (sketching && (k === 'Backspace' || k === 'Delete' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && k.toLowerCase() === 'z'))) {
      // While sketching these edit the sketch, never the selected features / undo stack.
      undoVertex();
      consume();
    }
  };
  window.addEventListener('keydown', onKey, true);

  const viewport = handle.map.getViewport()!;
  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const snapOn = useEdit.getState().snapping;
    showContextMenu(e, [
      { label: 'Finish  (F2)', icon: icon(CheckCheck), onClick: finish, disabled: !sketching },
      { label: 'Delete Vertex  (Backspace)', icon: icon(Undo2), onClick: undoVertex, disabled: !sketching },
      { label: 'Cancel Sketch  (Esc)', icon: icon(X), onClick: cancel, disabled: !sketching },
      'separator',
      { label: 'Snapping', icon: icon(Magnet), checked: snapOn, onClick: () => useEdit.setState({ snapping: !snapOn }) },
      { label: 'Feature Templates…', icon: icon(LayoutTemplate), onClick: () => openPane('create-features') },
      { label: 'Clear Selection', icon: icon(Eraser), onClick: () => clearSelection() },
    ]);
  };
  viewport.addEventListener('contextmenu', onContext);

  return () => {
    unsubEdit();
    unsubProject();
    window.removeEventListener('keydown', onKey, true);
    viewport.removeEventListener('contextmenu', onContext);
    snapper.dispose();
    if (draw) {
      draw.abortDrawing();
      handle.map.removeInteraction(draw);
    }
    handle.setDragPan(true);
    hint.remove();
  };
}
