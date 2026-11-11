// Explore tool: click to identify features in a pop-up anchored at the click.
import { useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Overlay from 'ol/Overlay';
import type { Coordinate } from 'ol/coordinate';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import { ChevronLeft, ChevronRight, Focus, MousePointer2, SquareMousePointer, Table2, X, Zap } from 'lucide-react';
import { findFeatureLayer } from '../../core/store';
import { clearSelection, openTable, setSelection } from '../../core/ui';
import { registerMapTool } from '../../core/registry';
import { tryCompile } from '../../core/expr';
import type { Hit, MapHandle } from '../../map/handle';
import { IconButton } from '../../ui/kit';
import { formatValue } from './format';

interface Popup {
  overlay: Overlay;
  root: Root;
}
const popups = new WeakMap<MapHandle, Popup>();

export function closeIdentify(handle: MapHandle) {
  const p = popups.get(handle);
  if (!p) return;
  popups.delete(handle);
  handle.map.removeOverlay(p.overlay);
  // Unmount after the current React event so closing from inside the card is safe.
  setTimeout(() => p.root.unmount(), 0);
}

export function hasIdentify(handle: MapHandle) {
  return popups.has(handle);
}

/** Show the identify pop-up for hits at a map coordinate. */
export function showIdentify(handle: MapHandle, coordinate: Coordinate, hits: Hit[]) {
  closeIdentify(handle);
  if (!hits.length) return;
  const el = document.createElement('div');
  el.className = 'nav-popup';
  const overlay = new Overlay({
    element: el,
    position: coordinate,
    positioning: 'bottom-center',
    offset: [0, -10],
    stopEvent: true,
    autoPan: { animation: { duration: 220 }, margin: 24 },
  });
  handle.map.addOverlay(overlay);
  const root = createRoot(el);
  popups.set(handle, { overlay, root });
  root.render(<IdentifyCard handle={handle} hits={hits} onClose={() => closeIdentify(handle)} />);
}

/** Hit-test a pixel and show the pop-up (or close it when nothing is there). */
export function identifyAt(handle: MapHandle, pixel: number[], coordinate: Coordinate) {
  const hits = handle.hitTest(pixel, { tolerance: 5, includeUnselectable: true });
  if (hits.length) showIdentify(handle, coordinate, hits);
  else closeIdentify(handle);
  return hits.length;
}

function IdentifyCard({ handle, hits, onClose }: { handle: MapHandle; hits: Hit[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const hit = hits[i];
  const info = findFeatureLayer(hit.layerId);
  const layer = info?.layer;
  const ds = info?.dataset;

  useEffect(() => {
    handle.flash([hit.feat.geometry]);
  }, [handle, hit]);

  const title = useMemo(() => {
    const feat = hit.feat;
    if (layer?.popup?.title?.trim()) {
      const { fn } = tryCompile(layer.popup.title);
      if (fn) {
        const v = fn({ id: feat.id, properties: feat.properties, geometry: feat.geometry });
        if (v !== null && v !== undefined && String(v).trim() !== '') return String(v);
      }
    }
    const first = ds?.fields.find((f) => f.type === 'string' && String(feat.properties[f.name] ?? '').trim() !== '');
    return first ? String(feat.properties[first.name]) : `Feature ${feat.id}`;
  }, [hit, layer?.popup?.title, ds]);

  const rows = useMemo(() => {
    const names = layer?.popup?.fields ?? ds?.fields.map((f) => f.name) ?? Object.keys(hit.feat.properties);
    return names.map((name) => {
      const field = ds?.fields.find((f) => f.name === name);
      return { label: field?.alias || name, value: formatValue(hit.feat.properties[name], field ?? { name, type: 'string' }) };
    });
  }, [hit, layer?.popup?.fields, ds]);

  const n = hits.length;
  return (
    <div className="nav-popup-card" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="nav-popup-head">
        <div className="grow">
          <div className="nav-popup-layer">{layer?.name ?? 'Layer'}</div>
          <div className="nav-popup-title" title={title}>{title}</div>
        </div>
        <IconButton icon={X} title="Close (Esc)" onClick={onClose} />
      </div>
      <div className="nav-popup-grid selectable">
        {rows.length === 0 && <div className="nav-null" style={{ gridColumn: '1 / -1' }}>No attributes</div>}
        {rows.map((r) => (
          <div className="nav-popup-row" key={r.label}>
            <span className="k" title={r.label}>{r.label}</span>
            <span className="v">
              {r.value.kind === 'null' ? <span className="nav-null">&mdash;</span> : r.value.kind === 'link' ? (
                <a href={r.value.href} target="_blank" rel="noopener noreferrer">{r.value.text}</a>
              ) : r.value.text}
            </span>
          </div>
        ))}
      </div>
      <div className="nav-popup-foot">
        {n > 1 ? (
          <div className="nav-pager">
            <IconButton icon={ChevronLeft} title="Previous feature" onClick={() => setI((i + n - 1) % n)} />
            <span>{i + 1} of {n}</span>
            <IconButton icon={ChevronRight} title="Next feature" onClick={() => setI((i + 1) % n)} />
          </div>
        ) : (
          <span className="nav-fid">FID {hit.fid}</span>
        )}
        <span className="grow" />
        <IconButton icon={Focus} title="Zoom to feature" onClick={() => handle.zoomToFeatures(hit.layerId, [hit.fid])} />
        <IconButton icon={Zap} title="Flash feature" onClick={() => handle.flash([hit.feat.geometry])} />
        <IconButton
          icon={SquareMousePointer}
          title="Select feature (Shift adds)"
          onClick={(e) => {
            if (e.shiftKey) setSelection(hit.layerId, [hit.fid], 'add');
            else {
              clearSelection();
              setSelection(hit.layerId, [hit.fid], 'new');
            }
          }}
        />
        <IconButton icon={Table2} title="Open attribute table" onClick={() => openTable(hit.layerId)} />
      </div>
    </div>
  );
}

export function registerExploreTool() {
  registerMapTool(
    {
      id: 'explore',
      title: 'Explore',
      icon: MousePointer2,
      cursor: 'default',
      activate(handle) {
        const onClick = (e: MapBrowserEvent<any>) => identifyAt(handle, e.pixel, e.coordinate);
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeIdentify(handle);
        const onView = () => closeIdentify(handle);
        handle.map.on('click', onClick);
        handle.map.on('change:view', onView);
        document.addEventListener('keydown', onKey);
        return () => {
          handle.map.un('click', onClick);
          handle.map.un('change:view', onView);
          document.removeEventListener('keydown', onKey);
          closeIdentify(handle);
        };
      },
    },
    { shortcut: 'Escape', description: 'Pan, zoom and click features to see their attributes', keywords: 'identify pan navigate pointer' },
  );
}
