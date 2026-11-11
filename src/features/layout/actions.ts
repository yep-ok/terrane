// Layout editing actions shared by the view (keyboard, context menu), the pane and commands.
import type { Id, LayoutDoc, LayoutElement, LayoutElementType } from '../../core/types';
import { uid } from '../../core/data';
import { getLayout, getMap, getProject } from '../../core/store';
import { notify } from '../../core/ui';
import { pickFiles } from '../../ui/kit';
import { alignRects, distributeRects, fitZoom, NOMINAL_PX_PER_MM, type AlignMode } from './geometry';
import {
  editLayout, getSelectionIds, getViewState, patchElements, selectedElements, setSelectionIds, setViewState,
} from './session';
import {
  DEFAULT_SIZE, frameName, imageProps, legendProps, makeElement, makeMapFrame, northArrowProps, rectProps, scaleBarProps, textProps,
} from './elements';
import { metaOf } from './types';

// ---------- view ----------

export function zoomToPage(layoutId: Id) {
  const l = getLayout(layoutId);
  if (!l) return;
  const { viewport } = getViewState(layoutId);
  const zoom = fitZoom(l.page, viewport, 28);
  setViewState(layoutId, {
    zoom,
    panX: (viewport.width - l.page.width * zoom) / 2,
    panY: (viewport.height - l.page.height * zoom) / 2,
    fitted: true,
  });
}

/** Zoom around a viewport point (defaults to the viewport centre). */
export function zoomAt(layoutId: Id, zoom: number, at?: { x: number; y: number }) {
  const v = getViewState(layoutId);
  const z = Math.min(60, Math.max(0.2, zoom));
  const cx = at?.x ?? v.viewport.width / 2;
  const cy = at?.y ?? v.viewport.height / 2;
  setViewState(layoutId, { zoom: z, panX: cx - ((cx - v.panX) * z) / v.zoom, panY: cy - ((cy - v.panY) * z) / v.zoom });
}
export const zoomActual = (layoutId: Id) => zoomAt(layoutId, NOMINAL_PX_PER_MM);
export const zoomStep = (layoutId: Id, dir: 1 | -1) => zoomAt(layoutId, getViewState(layoutId).zoom * (dir > 0 ? 1.25 : 0.8));

/** Page-space point at the centre of the visible area, clamped to the page. */
function visibleCentre(l: LayoutDoc, layoutId: Id) {
  const v = getViewState(layoutId);
  const x = (v.viewport.width / 2 - v.panX) / v.zoom;
  const y = (v.viewport.height / 2 - v.panY) / v.zoom;
  return { x: Math.min(l.page.width, Math.max(0, x)), y: Math.min(l.page.height, Math.max(0, y)) };
}

// ---------- insert ----------

function addElements(layoutId: Id, els: LayoutElement[], label: string) {
  editLayout(layoutId, label, (l) => void l.elements.unshift(...els));
  setSelectionIds(layoutId, els.map((e) => e.id));
}

function placed(l: LayoutDoc, layoutId: Id, type: LayoutElementType, size?: [number, number]) {
  const [w0, h0] = size ?? DEFAULT_SIZE[type];
  const w = Math.min(w0, l.page.width);
  const h = Math.min(h0, l.page.height);
  const c = visibleCentre(l, layoutId);
  return {
    x: Math.round(Math.min(l.page.width - w, Math.max(0, c.x - w / 2))),
    y: Math.round(Math.min(l.page.height - h, Math.max(0, c.y - h / 2))),
    w,
    h,
  };
}

/** Selected map frame, else the top-most one. */
function targetFrame(l: LayoutDoc, layoutId: Id): Id {
  const sel = new Set(getSelectionIds(layoutId));
  return (l.elements.find((e) => e.type === 'map' && sel.has(e.id)) ?? l.elements.find((e) => e.type === 'map'))?.id ?? '';
}

export async function insertElement(layoutId: Id, type: LayoutElementType, arg?: any) {
  const l = getLayout(layoutId);
  if (!l) return;
  const frameId = targetFrame(l, layoutId);
  switch (type) {
    case 'map': {
      const map = getMap(arg) ?? getProject().maps[0];
      if (!map) return notify('The project has no maps to show in a map frame.', 'warning');
      const el = makeMapFrame(map, placed(l, layoutId, 'map'));
      el.name = frameName(l, map.id);
      return addElements(layoutId, [el], 'Insert Map Frame');
    }
    case 'text':
      return addElements(layoutId, [makeElement('text', placed(l, layoutId, 'text'), textProps({ text: arg ?? 'Text' }))], 'Insert Text');
    case 'legend':
      return addElements(layoutId, [makeElement('legend', placed(l, layoutId, 'legend'), legendProps(frameId))], 'Insert Legend');
    case 'scalebar':
      return addElements(layoutId, [makeElement('scalebar', placed(l, layoutId, 'scalebar'), scaleBarProps(frameId))], 'Insert Scale Bar');
    case 'northarrow':
      return addElements(layoutId, [makeElement('northarrow', placed(l, layoutId, 'northarrow'), northArrowProps(frameId))], 'Insert North Arrow');
    case 'rect':
      return addElements(layoutId, [makeElement('rect', placed(l, layoutId, 'rect'), rectProps())], 'Insert Rectangle');
    case 'image': {
      const img = await chooseImage();
      if (!img) return;
      const maxW = Math.min(80, l.page.width * 0.5);
      const w = maxW;
      const h = Math.min(l.page.height * 0.6, (w * img.naturalHeight) / Math.max(1, img.naturalWidth));
      const el = makeElement('image', placed(l, layoutId, 'image', [w, h]), imageProps(img), img.name);
      return addElements(layoutId, [el], 'Insert Picture');
    }
    case 'chart':
      return notify('Charts cannot be placed on layouts yet.', 'info');
  }
}

/** File picker -> data URL + natural size. */
export async function chooseImage(): Promise<{ src: string; naturalWidth: number; naturalHeight: number; name: string } | null> {
  const [file] = await pickFiles('image/png,image/jpeg,image/gif,image/webp,image/svg+xml');
  if (!file) return null;
  if (file.size > 15 * 1024 * 1024) {
    notify('Pictures larger than 15 MB are not supported.', 'warning');
    return null;
  }
  const src = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    notify(`${file.name} could not be read as an image.`, 'error');
    return null;
  }
  return { src, naturalWidth: img.naturalWidth || 100, naturalHeight: img.naturalHeight || 100, name: file.name.replace(/\.[^.]+$/, '') };
}

// ---------- selection-based edits ----------

const editable = (els: LayoutElement[]) => els.filter((e) => !e.props.locked);

export function deleteSelection(layoutId: Id) {
  const ids = new Set(editable(selectedElements(layoutId)).map((e) => e.id));
  if (!ids.size) return;
  editLayout(layoutId, ids.size > 1 ? `Delete ${ids.size} Elements` : 'Delete Element', (l) => {
    l.elements = l.elements.filter((e) => !ids.has(e.id));
  });
  setSelectionIds(layoutId, []);
}

let clipboard: LayoutElement[] = [];
let pasteCount = 0;
export const hasClipboard = () => clipboard.length > 0;

export function copySelection(layoutId: Id) {
  const els = selectedElements(layoutId);
  if (!els.length) return;
  clipboard = JSON.parse(JSON.stringify(els));
  pasteCount = 0;
}
export function cutSelection(layoutId: Id) {
  copySelection(layoutId);
  deleteSelection(layoutId);
  pasteCount = -1;
}

function cloneInto(l: LayoutDoc, els: LayoutElement[], offset: number): LayoutElement[] {
  const idMap = new Map<Id, Id>();
  const out = els.map((e) => {
    const id = uid('el');
    idMap.set(e.id, id);
    const props = JSON.parse(JSON.stringify(e.props));
    delete props.locked;
    return { ...e, id, x: e.x + offset, y: e.y + offset, props };
  });
  // Keep links between copied elements; links to frames that exist in this layout stay as they are.
  for (const e of out) {
    const f = e.props.frameId;
    if (f && idMap.has(f)) e.props.frameId = idMap.get(f);
    else if (f && !l.elements.some((x) => x.id === f)) e.props.frameId = '';
  }
  return out;
}

export function paste(layoutId: Id) {
  const l = getLayout(layoutId);
  if (!l || !clipboard.length) return;
  pasteCount++;
  const els = cloneInto(l, clipboard, 5 * pasteCount);
  addElements(layoutId, els, 'Paste');
}

export function duplicateSelection(layoutId: Id) {
  const l = getLayout(layoutId);
  const els = selectedElements(layoutId);
  if (!l || !els.length) return;
  addElements(layoutId, cloneInto(l, els, 5), 'Duplicate');
}

export function selectAll(layoutId: Id) {
  const l = getLayout(layoutId);
  if (l) setSelectionIds(layoutId, l.elements.filter((e) => !e.props.locked && !e.props.hidden).map((e) => e.id));
}

export function nudge(layoutId: Id, dx: number, dy: number) {
  const els = editable(selectedElements(layoutId));
  if (!els.length) return;
  const patches: Record<Id, { x: number; y: number }> = {};
  for (const e of els) patches[e.id] = { x: Math.round((e.x + dx) * 100) / 100, y: Math.round((e.y + dy) * 100) / 100 };
  patchElements(layoutId, 'Nudge', patches, 'nudge');
}

/** Change stacking. elements[0] is on top, so "forward" moves towards index 0. */
export function reorder(layoutId: Id, how: 'forward' | 'backward' | 'front' | 'back') {
  const sel = new Set(getSelectionIds(layoutId));
  if (!sel.size) return;
  const label = { forward: 'Bring Forward', backward: 'Send Backward', front: 'Bring to Front', back: 'Send to Back' }[how];
  editLayout(layoutId, label, (l) => {
    const els = l.elements;
    if (how === 'front' || how === 'back') {
      const picked = els.filter((e) => sel.has(e.id));
      const rest = els.filter((e) => !sel.has(e.id));
      l.elements = how === 'front' ? [...picked, ...rest] : [...rest, ...picked];
      return;
    }
    const arr = [...els];
    if (how === 'forward') {
      for (let i = 1; i < arr.length; i++)
        if (sel.has(arr[i].id) && !sel.has(arr[i - 1].id)) [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
    } else {
      for (let i = arr.length - 2; i >= 0; i--)
        if (sel.has(arr[i].id) && !sel.has(arr[i + 1].id)) [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
    }
    l.elements = arr;
  });
}

/** Move one element to a new index (element list drag). */
export function moveElementTo(layoutId: Id, id: Id, toIndex: number) {
  editLayout(layoutId, 'Reorder Elements', (l) => {
    const from = l.elements.findIndex((e) => e.id === id);
    if (from < 0) return;
    const arr = [...l.elements];
    const [el] = arr.splice(from, 1);
    arr.splice(Math.max(0, Math.min(from < toIndex ? toIndex - 1 : toIndex, arr.length)), 0, el);
    l.elements = arr;
  });
}

/** Align the selection; a single element aligns to the page. */
export function align(layoutId: Id, mode: AlignMode) {
  const l = getLayout(layoutId);
  const els = editable(selectedElements(layoutId));
  if (!l || !els.length) return;
  const to = els.length === 1 ? { x: 0, y: 0, w: l.page.width, h: l.page.height } : undefined;
  const pos = alignRects(els, mode, to);
  const patches: Record<Id, { x: number; y: number }> = {};
  els.forEach((e, i) => (patches[e.id] = pos[i]));
  patchElements(layoutId, 'Align', patches);
}

export function distribute(layoutId: Id, axis: 'h' | 'v') {
  const els = editable(selectedElements(layoutId));
  if (els.length < 3) return notify('Select three or more elements to distribute them.', 'info');
  const pos = distributeRects(els, axis);
  const patches: Record<Id, { x: number; y: number }> = {};
  els.forEach((e, i) => (patches[e.id] = pos[i]));
  patchElements(layoutId, 'Distribute', patches);
}

export function setLocked(layoutId: Id, ids: Id[], locked: boolean) {
  const patches: Record<Id, { props: { locked: boolean } }> = {};
  for (const id of ids) patches[id] = { props: { locked } };
  patchElements(layoutId, locked ? 'Lock' : 'Unlock', patches);
}
export function setHidden(layoutId: Id, ids: Id[], hidden: boolean) {
  const patches: Record<Id, { props: { hidden: boolean } }> = {};
  for (const id of ids) patches[id] = { props: { hidden } };
  patchElements(layoutId, hidden ? 'Hide' : 'Show', patches);
}

// ---------- page ----------

export function setPage(layoutId: Id, width: number, height: number, scaleElements: boolean) {
  const l = getLayout(layoutId);
  if (!l || !(width > 0 && height > 0)) return;
  const sx = width / l.page.width;
  const sy = height / l.page.height;
  editLayout(layoutId, 'Page Setup', (d) => {
    d.page = { width, height };
    if (scaleElements && (sx !== 1 || sy !== 1)) {
      for (const e of d.elements) {
        e.x *= sx;
        e.y *= sy;
        e.w *= sx;
        e.h *= sy;
      }
    }
  });
}

export function setMeta(layoutId: Id, patch: Record<string, any>, label = 'Page Setup') {
  editLayout(layoutId, label, (l) => void Object.assign(l, patch), 'meta|' + Object.keys(patch).join(','));
}
export const marginOf = (l: LayoutDoc) => metaOf(l).margin ?? 10;
