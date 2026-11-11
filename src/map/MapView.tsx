import { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import { MapRuntime } from './runtime';
import { allMapPlugins, getMapTool } from '../core/registry';
import { useActiveTool, useUi } from '../core/ui';

/** Interactive map view (center area). One per open map tab; stays mounted while hidden. */
export function MapView({ refId, active }: { refId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [runtime, setRuntime] = useState<MapRuntime | null>(null);
  const tool = useActiveTool();

  useEffect(() => {
    const el = ref.current!;
    const rt = new MapRuntime({ mapId: refId, target: el });
    const cleanups = allMapPlugins().map((p) => {
      try {
        return p(rt);
      } catch (err) {
        console.error('map plugin failed', err);
      }
    });
    const ro = new ResizeObserver(() => rt.map.updateSize());
    ro.observe(el);
    setRuntime(rt);
    return () => {
      ro.disconnect();
      cleanups.forEach((c) => c && c());
      rt.destroy();
      setRuntime(null);
    };
  }, [refId]);

  // Activate the current map tool on the visible map.
  useEffect(() => {
    if (!runtime || !active) return;
    const def = getMapTool(tool) ?? getMapTool('explore');
    const viewport = runtime.map.getViewport()!;
    viewport.style.cursor = def?.cursor ?? '';
    let cleanup: void | (() => void);
    try {
      cleanup = def?.activate(runtime);
    } catch (err) {
      console.error('tool activation failed', err);
    }
    return () => {
      try {
        cleanup?.();
      } catch (err) {
        console.error(err);
      }
      runtime.setDragPan(true);
      viewport.style.cursor = '';
    };
  }, [runtime, active, tool]);

  useEffect(() => {
    if (runtime && active) {
      runtime.map.updateSize();
      useUi.setState({ scale: runtime.getScale() });
    }
  }, [runtime, active]);

  return <div className="mapview" ref={ref} data-map-id={refId} onPointerLeave={() => useUi.setState({ cursor: null })} />;
}
