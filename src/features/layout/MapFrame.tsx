// Map frame element: a static MapRuntime rendered at the frame's 96-dpi size and CSS-scaled
// to the layout zoom (so the map extent depends on the frame's paper size, not the screen
// zoom, and getScale() is the printed scale). Activating the frame adds pan/zoom interactions.
import { useEffect, useRef, useState } from 'react';
import { DragPan, DragRotate, MouseWheelZoom } from 'ol/interaction';
import { altShiftKeysOnly } from 'ol/events/condition';
import type Interaction from 'ol/interaction/Interaction';
import { MapMinus } from 'lucide-react';
import type { Id, LayoutElement, ViewState } from '../../core/types';
import { useMapDoc } from '../../core/store';
import { MapRuntime } from '../../map/runtime';
import { NOMINAL_PX_PER_MM, clamp } from './geometry';
import { editLayout } from './session';
import type { MapFrameProps } from './types';

const viewsEqual = (a: ViewState, b: ViewState) =>
  Math.abs(a.zoom - b.zoom) < 1e-6 &&
  Math.abs(a.rotation - b.rotation) < 1e-7 &&
  Math.abs(a.center[0] - b.center[0]) < 1e-9 &&
  Math.abs(a.center[1] - b.center[1]) < 1e-9;

/** Live runtimes of mounted frames, by element id (used by the scale box). */
export const frameRuntimes = new Map<Id, MapRuntime>();

function quantizedRatio(r: number) {
  const q = Math.pow(2, Math.round(Math.log2(clamp(r, 0.25, 4)) * 2) / 2);
  return Math.round(q * 1000) / 1000;
}

export function MapFrame({ layoutId, el, zoom, active }: { layoutId: Id; el: LayoutElement; zoom: number; active: boolean }) {
  const p = el.props as MapFrameProps;
  const map = useMapDoc(p.mapId);
  const host = useRef<HTMLDivElement>(null);
  const [rt, setRt] = useState<MapRuntime | null>(null);
  const viewRef = useRef(p.view);
  viewRef.current = p.view;
  const nominalW = el.w * NOMINAL_PX_PER_MM;
  const nominalH = el.h * NOMINAL_PX_PER_MM;
  const mapExists = !!map;

  useEffect(() => {
    if (!mapExists || !host.current) return;
    const runtime = new MapRuntime({
      mapId: p.mapId,
      target: host.current,
      interactive: false,
      view: viewRef.current,
      pixelRatio: quantizedRatio((window.devicePixelRatio || 1) * (zoom / NOMINAL_PX_PER_MM)),
      onViewChange: (v) => {
        const cur = viewRef.current;
        if (cur && viewsEqual(cur, v)) return;
        editLayout(layoutId, 'Navigate Map Frame', (l) => {
          const e = l.elements.find((x) => x.id === el.id);
          if (e) e.props = { ...e.props, view: v };
        }, 'frame-view|' + el.id);
      },
    });
    frameRuntimes.set(el.id, runtime);
    setRt(runtime);
    return () => {
      if (frameRuntimes.get(el.id) === runtime) frameRuntimes.delete(el.id);
      runtime.destroy();
      setRt(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.mapId, mapExists, el.id, layoutId]);

  // Size follows the frame's paper size.
  useEffect(() => {
    rt?.map.updateSize();
  }, [rt, nominalW, nominalH]);

  // Store -> view (undo, scale box, pane edits).
  useEffect(() => {
    if (!rt || !p.view) return;
    if (!viewsEqual(rt.getViewState(), p.view)) rt.setViewState(p.view, false);
  }, [rt, p.view]);

  // Keep the canvas crisp at the current screen zoom (debounced, quantised).
  useEffect(() => {
    if (!rt) return;
    const t = setTimeout(() => {
      const ratio = quantizedRatio((window.devicePixelRatio || 1) * (zoom / NOMINAL_PX_PER_MM));
      if (rt.map.getPixelRatio() !== ratio) rt.map.setPixelRatio(ratio);
    }, 160);
    return () => clearTimeout(t);
  }, [rt, zoom]);

  // Activation: pan / zoom / rotate inside the frame.
  useEffect(() => {
    if (!rt || !active) return;
    const list: Interaction[] = [
      new DragPan({ condition: (e) => { const b = (e.originalEvent as PointerEvent).button; return (b === 0 || b === 1) && !e.originalEvent.altKey; } }),
      new MouseWheelZoom({ constrainResolution: false }),
      new DragRotate({ condition: altShiftKeysOnly }),
    ];
    list.forEach((i) => rt.map.addInteraction(i));
    return () => list.forEach((i) => rt.map.removeInteraction(i));
  }, [rt, active]);

  const s = zoom / NOMINAL_PX_PER_MM;
  const bw = p.borderWidth > 0 ? Math.max(1, p.borderWidth * zoom) : 0;
  return (
    <div className="layout-frame" style={{ background: p.background || 'transparent' }}>
      {map ? (
        <div
          ref={host}
          className="layout-frame-map"
          style={{ width: nominalW, height: nominalH, transform: `scale(${s})`, pointerEvents: active ? 'auto' : 'none' }}
        />
      ) : (
        <div className="layout-frame-missing">
          <MapMinus />
          <span>Map not found</span>
        </div>
      )}
      {bw > 0 && <div className="layout-frame-border" style={{ borderWidth: bw, borderColor: p.borderColor }} />}
    </div>
  );
}
