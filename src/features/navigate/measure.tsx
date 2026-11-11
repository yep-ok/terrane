// Distance and area measuring: geodesic, live readout, persistent results panel inside the map.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import Draw from 'ol/interaction/Draw';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import type { Geometry as OlGeometry } from 'ol/geom';
import type LineString from 'ol/geom/LineString';
import type Polygon from 'ol/geom/Polygon';
import { never } from 'ol/events/condition';
import { unByKey } from 'ol/Observable';
import type { EventsKey } from 'ol/events';
import { Circle, Fill, Stroke, Style, Text } from 'ol/style';
import { Copy, Eraser, Ruler, SquareDashed, Trash2 } from 'lucide-react';
import type { Id } from '../../core/types';
import { uid } from '../../core/data';
import { notify, useUi } from '../../core/ui';
import { registerCommand, registerMapPlugin, registerMapTool } from '../../core/registry';
import { getMapHandle, type MapHandle } from '../../map/handle';
import { Button } from '../../ui/kit';
import { pathLength, ringArea } from './spatial';
import { UNIT_SYSTEMS, formatArea, formatLength, loadUnitSystem, saveUnitSystem, type UnitSystem } from './units';

interface Result {
  id: string;
  kind: 'distance' | 'area';
  total?: number; // m
  segments?: number[]; // m
  area?: number; // m2
  perimeter?: number; // m
}
interface Live {
  kind: 'distance' | 'area';
  segment?: number;
  total?: number;
  area?: number;
  perimeter?: number;
}
interface MeasureState {
  unit: UnitSystem;
  live: Record<Id, Live | null>;
  results: Record<Id, Result[]>;
  setUnit(u: UnitSystem): void;
  setLive(mapId: Id, l: Live | null): void;
  addResult(mapId: Id, r: Result): void;
  reset(mapId: Id): void;
}

export const useMeasure = create<MeasureState>()((set) => ({
  unit: loadUnitSystem(),
  live: {},
  results: {},
  setUnit: (unit) => {
    saveUnitSystem(unit);
    set({ unit });
  },
  setLive: (mapId, l) => set((s) => ({ live: { ...s.live, [mapId]: l } })),
  addResult: (mapId, r) => set((s) => ({ results: { ...s.results, [mapId]: [r, ...(s.results[mapId] ?? [])] } })),
  reset: (mapId) => set((s) => ({ results: { ...s.results, [mapId]: [] }, live: { ...s.live, [mapId]: null } })),
}));

// ---------- text ----------

export function resultLines(r: Result, unit: UnitSystem): string[] {
  if (r.kind === 'distance') {
    const lines = [`Length: ${formatLength(r.total ?? 0, unit)}`];
    if ((r.segments?.length ?? 0) > 1) r.segments!.forEach((s, i) => lines.push(`  Segment ${i + 1}: ${formatLength(s, unit)}`));
    return lines;
  }
  return [`Area: ${formatArea(r.area ?? 0, unit)}`, `Perimeter: ${formatLength(r.perimeter ?? 0, unit)}`];
}
const labelOf = (r: Result, unit: UnitSystem) => (r.kind === 'distance' ? formatLength(r.total ?? 0, unit) : formatArea(r.area ?? 0, unit));

// ---------- geometry ----------

const ll = (h: MapHandle, coords: number[][]) => coords.map((c) => h.toLonLat(c) as number[]);

function lineMetrics(h: MapHandle, coords: number[][]) {
  const pts = ll(h, coords);
  const segments: number[] = [];
  for (let i = 1; i < pts.length; i++) segments.push(pathLength([pts[i - 1], pts[i]]));
  return { segments, total: segments.reduce((a, b) => a + b, 0) };
}
function ringMetrics(h: MapHandle, ring: number[][]) {
  const pts = ll(h, ring);
  return { area: ringArea(pts), perimeter: pathLength(pts) };
}

function liveOf(h: MapHandle, kind: 'distance' | 'area', g: OlGeometry): Live {
  if (kind === 'distance') {
    const { segments, total } = lineMetrics(h, (g as LineString).getCoordinates());
    return { kind, segment: segments[segments.length - 1] ?? 0, total };
  }
  const ring = (g as Polygon).getCoordinates()[0] ?? [];
  return { kind, ...ringMetrics(h, ring) };
}

// ---------- styles ----------

const ACCENT = '#ff8f00';
const sketchStyle = [
  new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 4.5 }) }),
  new Style({
    stroke: new Stroke({ color: ACCENT, width: 2, lineDash: [7, 5] }),
    fill: new Fill({ color: 'rgba(255,143,0,0.14)' }),
    image: new Circle({ radius: 4.5, fill: new Fill({ color: ACCENT }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }),
  }),
];
const lineStyle = [
  new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,0.9)', width: 4.5 }) }),
  new Style({ stroke: new Stroke({ color: ACCENT, width: 2 }), fill: new Fill({ color: 'rgba(255,143,0,0.16)' }) }),
];
const vertexStyle = new Style({ image: new Circle({ radius: 3.5, fill: new Fill({ color: '#fff' }), stroke: new Stroke({ color: ACCENT, width: 2 }) }) });
const labelStyle = (text: string) =>
  new Style({
    text: new Text({
      text,
      font: '600 12px "Segoe UI", system-ui, sans-serif',
      offsetY: -14,
      fill: new Fill({ color: '#1f2328' }),
      backgroundFill: new Fill({ color: 'rgba(255,255,255,0.94)' }),
      backgroundStroke: new Stroke({ color: ACCENT, width: 1 }),
      padding: [2, 5, 2, 5],
    }),
  });

function commitResult(h: MapHandle, kind: 'distance' | 'area', g: OlGeometry) {
  const unit = useMeasure.getState().unit;
  const id = uid('meas');
  let result: Result;
  let anchor: number[];
  let vertices: number[][];
  if (kind === 'distance') {
    const coords = (g as LineString).getCoordinates();
    if (coords.length < 2) return;
    const m = lineMetrics(h, coords);
    result = { id, kind, total: m.total, segments: m.segments };
    anchor = coords[coords.length - 1];
    vertices = coords;
  } else {
    const ring = (g as Polygon).getCoordinates()[0] ?? [];
    if (ring.length < 4) return;
    result = { id, kind, ...ringMetrics(h, ring) };
    const ip = (g as Polygon).getInteriorPoint().getCoordinates();
    anchor = [ip[0], ip[1]];
    vertices = ring.slice(0, -1);
  }
  const shape = new Feature(g);
  shape.set('kind', 'measure');
  shape.setStyle(lineStyle);
  const feats: Feature[] = [shape];
  for (const v of vertices) {
    const f = new Feature(new Point(v));
    f.set('kind', 'measure');
    f.setStyle(vertexStyle);
    feats.push(f);
  }
  const label = new Feature(new Point(anchor));
  label.set('kind', 'measure');
  label.set('result', result);
  label.setStyle(labelStyle(labelOf(result, unit)));
  feats.push(label);
  h.scratch.addFeatures(feats);
  useMeasure.getState().addResult(h.mapId, result);
}

function clearMeasurements(h: MapHandle) {
  for (const f of h.scratch.getFeatures()) if (f.get('kind') === 'measure') h.scratch.removeFeature(f);
  useMeasure.getState().reset(h.mapId);
}

// ---------- tools ----------

function measureTool(kind: 'distance' | 'area') {
  return (handle: MapHandle) => {
    handle.setDragPan(false);
    const store = useMeasure.getState();
    store.setLive(handle.mapId, null);
    const draw = new Draw({
      type: kind === 'distance' ? 'LineString' : 'Polygon',
      style: sketchStyle,
      condition: (e) => (e.originalEvent as MouseEvent).button === 0,
      freehandCondition: never,
    });
    let key: EventsKey | undefined;
    const stop = () => {
      if (key) unByKey(key);
      key = undefined;
      useMeasure.getState().setLive(handle.mapId, null);
    };
    draw.on('drawstart', (e) => {
      const g = e.feature.getGeometry()!;
      const update = () => useMeasure.getState().setLive(handle.mapId, liveOf(handle, kind, g));
      update();
      key = g.on('change', update);
    });
    draw.on('drawend', (e) => {
      stop();
      const g = e.feature.getGeometry();
      if (g) commitResult(handle, kind, g.clone());
    });
    draw.on('drawabort', stop);
    const onKey = (e: KeyboardEvent) => e.key === 'Enter' && draw.finishDrawing();
    document.addEventListener('keydown', onKey);
    handle.map.addInteraction(draw);
    return () => {
      document.removeEventListener('keydown', onKey);
      stop();
      handle.map.removeInteraction(draw);
      handle.setDragPan(true);
    };
  };
}

// ---------- panel ----------

function MeasurePanel({ handle }: { handle: MapHandle }) {
  const unit = useMeasure((s) => s.unit);
  const live = useMeasure((s) => s.live[handle.mapId]);
  const results = useMeasure((s) => s.results[handle.mapId]) ?? [];
  const tool = useUi((s) => s.activeTool);
  const [collapsed, setCollapsed] = useState(false);
  const measuring = tool === 'measure-distance' || tool === 'measure-area';
  if (!measuring && !results.length) return null;

  const copy = async () => {
    const text = results.map((r) => resultLines(r, unit).join('\n')).join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      notify('Measurements copied', 'success');
    } catch {
      notify('Could not access the clipboard', 'error');
    }
  };
  return (
    <div className="nav-measure">
      <div className="nav-measure-head">
        <button type="button" className="nav-measure-title" onClick={() => setCollapsed(!collapsed)} title="Collapse / expand">
          {tool === 'measure-area' ? <SquareDashed size={14} /> : <Ruler size={14} />}
          <span>Measure</span>
        </button>
        <span className="grow" />
        <select className="select nav-unit" value={unit} onChange={(e) => useMeasure.getState().setUnit(e.target.value as UnitSystem)} title="Units">
          {UNIT_SYSTEMS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
      </div>
      {!collapsed && (
        <>
          {live && (
            <div className="nav-measure-live">
              {live.kind === 'distance' ? (
                <>
                  <div><span>Segment</span><b>{formatLength(live.segment ?? 0, unit)}</b></div>
                  <div><span>Total</span><b>{formatLength(live.total ?? 0, unit)}</b></div>
                </>
              ) : (
                <>
                  <div><span>Area</span><b>{formatArea(live.area ?? 0, unit)}</b></div>
                  <div><span>Perimeter</span><b>{formatLength(live.perimeter ?? 0, unit)}</b></div>
                </>
              )}
            </div>
          )}
          {!live && measuring && !results.length && (
            <div className="nav-measure-hint">Click to add points. Double-click or press Enter to finish.</div>
          )}
          {results.length > 0 && (
            <div className="nav-measure-results selectable">
              {results.map((r) => (
                <div className="nav-measure-result" key={r.id}>
                  {r.kind === 'distance' ? <Ruler size={13} /> : <SquareDashed size={13} />}
                  <div>{resultLines(r, unit).map((l, i) => <div key={i} className={l.startsWith('  ') ? 'seg' : undefined}>{l.trim()}</div>)}</div>
                </div>
              ))}
            </div>
          )}
          <div className="nav-measure-foot">
            <Button icon={Copy} onClick={copy} disabled={!results.length}>Copy</Button>
            <Button icon={Trash2} onClick={() => clearMeasurements(handle)} disabled={!results.length && !live}>Clear</Button>
          </div>
        </>
      )}
    </div>
  );
}

export function registerMeasure() {
  registerMapTool({ id: 'measure-distance', title: 'Measure Distance', icon: Ruler, cursor: 'crosshair', activate: measureTool('distance') },
    { description: 'Measure a geodesic distance along a path', keywords: 'length ruler' });
  registerMapTool({ id: 'measure-area', title: 'Measure Area', icon: SquareDashed, cursor: 'crosshair', activate: measureTool('area') },
    { description: 'Measure a geodesic area and its perimeter', keywords: 'polygon perimeter' });
  registerCommand({
    id: 'measure.clear', title: 'Clear Measurements', icon: Eraser, description: 'Remove measurement graphics from the map',
    run: () => {
      const h = getMapHandle();
      if (h) clearMeasurements(h);
    },
  });

  registerMapPlugin((handle) => {
    const host = document.createElement('div');
    host.className = 'nav-measure-host';
    handle.map.getTargetElement()!.appendChild(host);
    const root = createRoot(host);
    root.render(<MeasurePanel handle={handle} />);
    const onScratchClear = () => useMeasure.getState().reset(handle.mapId);
    handle.scratch.on('clear', onScratchClear);
    const unsub = useMeasure.subscribe((s, prev) => {
      if (s.unit === prev.unit) return;
      for (const f of handle.scratch.getFeatures()) {
        const r: Result | undefined = f.get('result');
        if (r) f.setStyle(labelStyle(labelOf(r, s.unit)));
      }
    });
    return () => {
      unsub();
      handle.scratch.un('clear', onScratchClear);
      setTimeout(() => root.unmount(), 0);
      host.remove();
    };
  });
}
